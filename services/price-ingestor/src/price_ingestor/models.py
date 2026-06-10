from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class RawPriceMessage:
    symbol: str
    price: float
    bid: float
    ask: float
    volume: float
    timestamp: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
