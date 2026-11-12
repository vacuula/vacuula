"""Persist Gen4 robot notifications.

Revision ID: c84f7e239a10
Revises: 5fe01baecb7b
"""

import sqlalchemy as sa
from alembic import op

revision = "c84f7e239a10"
down_revision = "5fe01baecb7b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "robot_notification",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("robot", sa.String(), nullable=False),
        sa.Column("request_id", sa.String(128), nullable=False),
        sa.Column("message_code", sa.String(128), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("received_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["robot"], ["robot.serial"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "robot", "request_id", name="uq_notification_robot_request"
        ),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_notification_robot_id", "robot_notification", ["robot", "id"])


def downgrade() -> None:
    op.drop_index("ix_notification_robot_id", table_name="robot_notification")
    op.drop_table("robot_notification")
