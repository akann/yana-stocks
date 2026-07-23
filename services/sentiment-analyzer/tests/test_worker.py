from sentiment_analyzer.worker import select_symbols_for_poll


def test_dynamic_symbols_always_included() -> None:
    symbols, _ = select_symbols_for_poll(
        dynamic_symbols={"XOM", "BP.L"},
        baseline_symbols=["AAPL", "MSFT", "GOOGL"],
        cursor=0,
        max_symbols=10,
    )
    assert "XOM" in symbols
    assert "BP.L" in symbols


def test_baseline_fills_remaining_budget() -> None:
    symbols, _ = select_symbols_for_poll(
        dynamic_symbols={"XOM"},
        baseline_symbols=["AAPL", "MSFT", "GOOGL"],
        cursor=0,
        max_symbols=3,
    )
    assert len(symbols) == 3
    assert symbols[0] == "XOM"
    assert set(symbols[1:]) <= {"AAPL", "MSFT", "GOOGL"}


def test_never_exceeds_max_symbols_even_with_many_dynamic() -> None:
    dynamic = {f"SYM{i}" for i in range(20)}
    symbols, _ = select_symbols_for_poll(
        dynamic_symbols=dynamic,
        baseline_symbols=["AAPL", "MSFT"],
        cursor=0,
        max_symbols=10,
    )
    assert len(symbols) == 10


def test_baseline_rotates_across_polls() -> None:
    baseline = ["A", "B", "C", "D", "E"]
    first, cursor = select_symbols_for_poll(
        dynamic_symbols=set(), baseline_symbols=baseline, cursor=0, max_symbols=2
    )
    second, cursor = select_symbols_for_poll(
        dynamic_symbols=set(), baseline_symbols=baseline, cursor=cursor, max_symbols=2
    )
    third, cursor = select_symbols_for_poll(
        dynamic_symbols=set(), baseline_symbols=baseline, cursor=cursor, max_symbols=2
    )

    assert first == ["A", "B"]
    assert second == ["C", "D"]
    assert third == ["E", "A"]


def test_baseline_rotation_wraps_around_and_covers_everything() -> None:
    baseline = [f"SYM{i}" for i in range(7)]
    seen: set[str] = set()
    cursor = 0
    for _ in range(4):  # ceil(7/2) polls needed to see every symbol at least once
        window, cursor = select_symbols_for_poll(
            dynamic_symbols=set(), baseline_symbols=baseline, cursor=cursor, max_symbols=2
        )
        seen.update(window)
    assert seen == set(baseline)


def test_dynamic_symbol_not_double_counted_in_baseline_window() -> None:
    symbols, _ = select_symbols_for_poll(
        dynamic_symbols={"AAPL"},
        baseline_symbols=["AAPL", "MSFT", "GOOGL"],
        cursor=0,
        max_symbols=3,
    )
    assert symbols.count("AAPL") == 1


def test_no_baseline_and_no_dynamic_returns_empty() -> None:
    symbols, cursor = select_symbols_for_poll(
        dynamic_symbols=set(), baseline_symbols=[], cursor=0, max_symbols=10
    )
    assert symbols == []
    assert cursor == 0
