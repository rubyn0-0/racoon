from racoon.api import DEV_ORIGINS, frontend_origins
from racoon.db import normalize_database_url


def test_origins_default_to_the_dev_server():
    assert frontend_origins("") == DEV_ORIGINS


def test_origins_add_hosted_frontends():
    origins = frontend_origins("https://user.github.io/, https://other.example ,")
    assert origins == DEV_ORIGINS + ["https://user.github.io", "https://other.example"]


def test_host_urls_use_the_psycopg_driver():
    assert normalize_database_url("postgresql://u:p@h/db?sslmode=require") == "postgresql+psycopg://u:p@h/db?sslmode=require"
    assert normalize_database_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"


def test_url_with_a_driver_is_left_alone():
    url = "postgresql+psycopg://u:p@localhost:5432/db"
    assert normalize_database_url(url) == url
