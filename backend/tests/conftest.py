import os

# Point the app at the test database before any app module is imported.
# Environment variables take priority over backend/.env in pydantic-settings.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://taggify:taggify_dev@localhost:5432/taggify_test"
)
