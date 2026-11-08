"""[1.1.0-b1] keep track of installed with

Revision ID: 5fe01baecb7b
Revises: f09399c9b238
Create Date: 2026-10-18 15:14:50.421700

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5fe01baecb7b'
down_revision: Union[str, Sequence[str], None] = 'f09399c9b238'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Existing rows get '1.0.0' via the server default
    op.add_column(
        'gen3__data',
        sa.Column('installed_with', sa.String(), nullable=False, server_default='1.0.0'),
    )
    # Drop the default so new inserts must set installed_with explicitly
    with op.batch_alter_table('gen3__data') as batch_op:
        batch_op.alter_column('installed_with', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('gen3__data', 'installed_with')
