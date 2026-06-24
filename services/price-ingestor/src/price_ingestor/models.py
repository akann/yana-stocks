from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class RawPriceMessage:
    symbol: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    timestamp: str  # bar start (UTC ISO)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
