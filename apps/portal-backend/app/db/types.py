from sqlalchemy.types import TypeDecorator, JSON, String
from sqlalchemy.dialects.postgresql import ARRAY

class RobustArray(TypeDecorator):
    """
    Uses PostgreSQL ARRAY type if available, otherwise falls back to JSON.
    Used for compatibility between Production (Postgres) and Test/Dev (SQLite) environments.
    """
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == 'postgresql':
            return dialect.type_descriptor(ARRAY(String))
        return dialect.type_descriptor(JSON)

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        if dialect.name == 'postgresql':
            return value
        return value

    def process_result_value(self, value, dialect):
        if value is None:
            return []
        if dialect.name == 'postgresql':
            return value
        return value
