"""How Alembic reaches the database: through the app's own engine, so DATABASE_URL in .env is the only setting."""
from alembic import context

from racoon.db import get_engine

config = context.config


def run_migrations(connection):
    context.configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()


# init_db() passes the connection it holds the migration lock on; the command line opens its own.
connection = config.attributes.get("connection")
if connection is not None:
    run_migrations(connection)
else:
    with get_engine().connect() as own_connection:
        run_migrations(own_connection)
        own_connection.commit()
