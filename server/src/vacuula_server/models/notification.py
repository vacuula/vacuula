from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from vacuula_server.db import Base


class RobotNotification(Base):
    __tablename__ = "robot_notification"
    __table_args__ = (
        UniqueConstraint("robot", "request_id", name="uq_notification_robot_request"),
        Index("ix_notification_robot_id", "robot", "id"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    robot: Mapped[str] = mapped_column(
        String, ForeignKey("robot.serial", ondelete="CASCADE"), nullable=False
    )
    request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    message_code: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    received_at: Mapped[str] = mapped_column(String, nullable=False)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "robot": self.robot,
            "message_code": self.message_code,
            "payload": self.payload,
            "received_at": self.received_at,
        }
