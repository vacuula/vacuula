from __future__ import annotations

from typing import List, Tuple
from sqlalchemy import String, JSON, Boolean, Float, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from vacuula_server.db import Base
Point = Tuple[float, float]


class PersistentMap(Base):
    __tablename__ = "persistent_map"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    robot: Mapped[str] = mapped_column(String, ForeignKey("robot.serial", ondelete='CASCADE'), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    in_maps_list: Mapped[bool] = mapped_column(Boolean, nullable=False) # if valid in case of gen3
    base: Mapped[Point] = mapped_column(JSON, nullable=False) # x, y


class FloorPlan(Base):
    __tablename__ = "gen4__floor_plan"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    robot: Mapped[str] = mapped_column(String, ForeignKey("robot.serial", ondelete='CASCADE'), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    promoted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    in_maps_list: Mapped[bool] = mapped_column(Boolean, nullable=False)
    base: Mapped[Tuple[float, float, float]] = mapped_column(JSON, nullable=False) # x, y, dir
    origin: Mapped[Point] = mapped_column(JSON, nullable=False) # x, y
    resolution: Mapped[float] = mapped_column(Float, nullable=False)
    alignment: Mapped[float] = mapped_column(Float, nullable=False)
    imgsize: Mapped[Tuple[int, int]] = mapped_column(JSON, nullable=False) # x, y
    created_at: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (
        Index(
            "uq_floor_plan_promoted_robot",
            "robot",
            unique=True,
            sqlite_where=(promoted.is_(True))
        ),
    )


class Boundary(Base):
    __tablename__ = "gen4__boundary"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    floorplan: Mapped[str] = mapped_column(String, ForeignKey("gen4__floor_plan.id", ondelete='CASCADE'), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False) # polygon/polyline, compatible with gen3 system
    function: Mapped[str] = mapped_column(String, nullable=False) # cleaning/nogo
    vertices: Mapped[List[Point]] = mapped_column(JSON, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)



