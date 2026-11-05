"""Remember deleted Gen3 maps without removing cleaning history."""
from alembic import op
import sqlalchemy as sa

revision = "a712d9f08c34"
down_revision = "5fe01baecb7b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "persistent_map",
        sa.Column("deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("persistent_map", "deleted")
