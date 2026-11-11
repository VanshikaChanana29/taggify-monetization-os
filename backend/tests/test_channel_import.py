import io

import pytest
from openpyxl import Workbook, load_workbook

from tests.test_channels_people import channel, cms, employee

UC1 = "UC" + "a" * 22
UC2 = "UC" + "b" * 22
UC3 = "UC" + "c" * 22
HEAD = "Channel ID,Channel name,Platform,CMS,Manager,Status,Link,Notes\n"


def link(uc: str) -> str:
    return f"https://www.youtube.com/channel/{uc}"


@pytest.fixture
def founder(make_founder, login):
    make_founder("a@taggify.in", name="Asha")
    return login("a@taggify.in")


def send(c, text: str, preview=False, name="channels.csv"):
    url = "/api/channels/import/preview" if preview else "/api/channels/import"
    return c.post(url, files={"file": (name, text.encode(), "text/csv")})


def test_all_but_manager_and_notes_are_required(founder):
    giri = cms(founder, "Giri CMS")
    cms(founder, "Meta P-01", platform="facebook")
    employee(founder, "Ananya Sharma")
    text = HEAD + (
        f"{UC1},Kapil Comedy 01,YouTube,giri cms,ananya sharma,Active,{link(UC1)},First\n"
        f"{UC2},No manager or notes,YouTube,Giri CMS,,inactive,{link(UC2)},\n"
        f"{link(UC3)},Unknown manager,YouTube,Giri CMS,Nobody,Active,{link(UC3)},\n"
        "1029384756,FB Page,Facebook,Meta P-01,,Active,https://www.facebook.com/1029384756,\n"
        f"{'UC' + 'd' * 22},,,,,,,\n"
        f"{'UC' + 'e' * 22},No CMS,YouTube,,,Active,{link(UC1)},\n"
        f"{'UC' + 'f' * 22},Unknown CMS,YouTube,Nope,,Active,{link(UC1)},\n"
        f"{'UC' + 'g' * 22},Wrong platform CMS,Facebook,Giri CMS,,Active,{link(UC1)},\n"
        f"{'UC' + 'h' * 22},Bad status,YouTube,Giri CMS,,Maybe,{link(UC1)},\n"
        f"{'UC' + 'i' * 22},No link,YouTube,Giri CMS,,Active,,\n"
        f"{'UC' + 'j' * 22},No platform,,Giri CMS,,Active,{link(UC1)},\n"
    )
    preview = send(founder, text, preview=True).json()
    assert (preview["added"], preview["errors"]) == (4, 7)
    assert founder.get("/api/channels").json()["total"] == 0  # preview saves nothing

    r = send(founder, text)
    assert r.status_code == 201, r.text
    lines = {x["line"]: x for x in r.json()["lines"]}
    assert (lines[2]["cms"], lines[2]["manager"], lines[2]["notes"]) == (
        "Giri CMS",
        "Ananya Sharma",
        [],
    )
    # Manager and notes are optional; an unknown manager still adds the channel, with a note.
    assert lines[3]["result"] == "new" and lines[3]["status"] == "inactive"
    assert lines[4]["result"] == "new" and lines[4]["manager"] is None
    assert lines[4]["external_id"] == UC3  # a full link is read as the ID
    assert lines[5]["platform"] == "facebook" and lines[5]["cms"] == "Meta P-01"
    # Every other column is required.
    assert all(lines[n]["result"] == "error" for n in range(6, 13))
    assert "No channel name." in lines[6]["notes"] and "No CMS." in lines[6]["notes"]
    assert "No CMS." in lines[7]["notes"]
    assert "not in the tool" in lines[8]["notes"][0]
    assert "Youtube CMS" in lines[9]["notes"][0]
    assert "not understood" in lines[10]["notes"][0]
    assert lines[11]["notes"][0] == "No link."
    assert lines[12]["notes"][0].startswith("No platform")

    rows = {c["external_id"]: c for c in founder.get("/api/channels?page_size=50").json()["items"]}
    assert rows[UC1]["cms_partner_id"] == giri and rows[UC1]["manager"]["name"] == "Ananya Sharma"
    assert rows[UC1]["url"] == link(UC1)
    assert rows[UC2]["status"] == "inactive"


def test_existing_and_repeated_ids_are_skipped(founder):
    cms(founder, "Giri CMS")
    channel(founder, "Already here", external_id=UC1)
    row = "{},{},YouTube,Giri CMS,,Active,https://youtube.com/x,\n"
    text = (
        HEAD + row.format(UC1, "Changed name") + row.format(UC2, "New") + row.format(UC2, "Again")
    )
    out = send(founder, text).json()
    assert (out["added"], out["exists"], out["duplicate"]) == (1, 1, 1)
    names = {c["external_id"]: c["name"] for c in founder.get("/api/channels").json()["items"]}
    assert names == {UC1: "Already here", UC2: "New"}
    # Uploading the same file again adds nothing.
    assert send(founder, text).json()["added"] == 0


def test_needs_every_required_column_and_reads_the_excel_template(founder):
    cms(founder, "Giri CMS")
    r = send(founder, "name,cms\nX,Y\n", preview=True)
    assert r.json()["missing_columns"] == ["Channel ID", "Platform", "Status", "Link"]
    r = send(
        founder,
        f"Channel ID,Channel name,Platform,CMS,Status\n{UC1},A,YouTube,Giri CMS,Active\n",
        True,
    )
    assert r.json()["missing_columns"] == ["Link"]
    assert send(founder, "name,cms\nX,Y\n").status_code == 422

    t = founder.get("/api/channels/import/template")
    assert t.status_code == 200
    ws = load_workbook(io.BytesIO(t.content)).active
    assert [c.value for c in ws[1]] == [
        "Channel ID",
        "Channel name",
        "Platform",
        "CMS",
        "Manager",
        "Status",
        "Link",
        "Notes",
        "Partner",
    ]

    wb = Workbook()
    wb.active.append(["Channel ID", "Channel name", "Platform", "CMS", "Status", "Link"])
    wb.active.append([UC1, "From Excel", "YouTube", "Giri CMS", "Active", link(UC1)])
    buf = io.BytesIO()
    wb.save(buf)
    r = founder.post(
        "/api/channels/import",
        files={"file": ("c.xlsx", buf.getvalue(), "application/octet-stream")},
    )
    assert r.status_code == 201 and r.json()["added"] == 1


def test_import_is_per_company(make_founder, login, founder):
    cms(founder, "CMS A")
    line = HEAD + f"{UC1},One,YouTube,CMS A,,Active,{link(UC1)},\n"
    send(founder, line)
    make_founder("s@sociodoor.in", org_slug="sociodoor")
    s = login("s@sociodoor.in")
    assert s.get("/api/channels").json()["total"] == 0
    assert send(s, line).json()["added"] == 0  # Sociodoor has no "CMS A" yet
    cms(s, "CMS A")
    assert send(s, line).json()["added"] == 1
