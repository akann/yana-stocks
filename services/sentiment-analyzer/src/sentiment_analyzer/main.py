import logging

from .config import Settings
from .worker import run


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    run(Settings())  # type: ignore[call-arg]  # required fields populated from env vars


if __name__ == "__main__":
    main()
