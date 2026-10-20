"""Uploaded files in Cloudflare R2: request signing, and documents/statements kept by key."""

import hashlib

import pytest
from sqlalchemy import select

from app.models import CmsStatement, DealDocument
from app.services import file_store
from tests.test_deal_assets import new_deal
from tests.test_finance import MONTH, slide9
from tests.test_payouts import founder  # noqa: F401
from tests.test_statements import STATEMENT, upload


def test_signature_matches_the_aws_example():
    """AWS's published Signature V4 example for S3 (GET /test.txt with a Range header)."""
    empty = hashlib.sha256(b"").hexdigest()
    auth = file_store.sign_v4(
        method="GET",
        host="examplebucket.s3.amazonaws.com",
        path="/test.txt",
        headers={
            "Host": "examplebucket.s3.amazonaws.com",
            "Range": "bytes=0-9",
            "x-amz-content-sha256": empty,
            "x-amz-date": "20130524T000000Z",
        },
        payload_hash=empty,
        region="us-east-1",
        access_key="AKIAIOSFODNN7EXAMPLE",
        secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        amz_date="20130524T000000Z",
    )
    assert auth == (
        "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, "
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, "
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    )


class FakeBucket:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}

    def put(self, key, data, content_type):
        self.objects[key] = (data, content_type)

    def get(self, key):
        if key not in self.objects:
            raise file_store.FileStoreError("missing")
        return self.objects[key][0]

    def delete(self, key):
        self.objects.pop(key, None)


@pytest.fixture
def bucket(monkeypatch):
    fake = FakeBucket()
    monkeypatch.setattr(file_store, "_store", fake)
    monkeypatch.setattr(file_store, "_checked", True)
    return fake


def test_documents_live_in_the_bucket(founder, bucket, db):  # noqa: F811
    d = new_deal(founder)
    r = founder.post(
        f"/api/deals/{d['id']}/documents",
        files=[("files", ("Sony agreement.pdf", b"%PDF-1.4 contract", "application/pdf"))],
    )
    assert r.status_code == 201, r.text
    doc_id = r.json()[0]["id"]
    row = db.scalar(select(DealDocument).where(DealDocument.id == doc_id))
    assert row.data is None and row.storage_key.endswith(".pdf")
    assert row.storage_key.split("/")[1] == "deal-documents"
    assert bucket.objects[row.storage_key] == (b"%PDF-1.4 contract", "application/pdf")

    assert founder.get(f"/api/documents/{doc_id}/download").content == b"%PDF-1.4 contract"
    assert founder.delete(f"/api/documents/{doc_id}").status_code == 204
    assert bucket.objects == {}


def test_a_bucket_failure_saves_nothing(founder, monkeypatch):  # noqa: F811
    class Down(FakeBucket):
        def put(self, key, data, content_type):
            raise file_store.FileStoreError("R2 is down")

    monkeypatch.setattr(file_store, "_store", Down())
    monkeypatch.setattr(file_store, "_checked", True)
    d = new_deal(founder)
    r = founder.post(
        f"/api/deals/{d['id']}/documents",
        files=[("files", ("a.pdf", b"%PDF", "application/pdf"))],
    )
    assert r.status_code == 502
    assert founder.get(f"/api/deals/{d['id']}").json()["document_count"] == 0


def test_statement_file_in_the_bucket_and_replaced(founder, bucket, db):  # noqa: F811
    cms_a = slide9(founder)
    st = upload(founder, cms_a, STATEMENT).json()["statement"]
    first = db.scalar(select(CmsStatement).where(CmsStatement.id == st["id"])).storage_key
    assert first and bucket.objects[first][1] == "text/csv"
    assert founder.get(f"/api/finance/statements/{st['id']}/file").content.decode() == STATEMENT

    # Typing totals in replaces the upload: the old file is removed from the bucket.
    r = founder.put(
        "/api/finance/statements",
        json={
            "cms_partner_id": cms_a,
            "month": MONTH,
            "currency": "USD",
            "gross_amount": "25000",
            "fee_amount": "3750",
            "net_amount": "21250",
        },
    )
    assert r.status_code == 200, r.text
    assert bucket.objects == {}
