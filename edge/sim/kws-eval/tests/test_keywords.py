import pytest

from kws_eval.keywords import (
    CORE_INTENTS,
    KEYWORDS,
    STOP,
    WAKE,
    KeywordSpec,
    KeywordTuning,
    keyword_by_name,
    keyword_file_lines,
    tokenize,
)

TOKENS = {
    t: i
    for i, t in enumerate(
        [
            "t",
            "íng",
            "x",
            "ià",
            "S",
            "T",
            "AA1",
            "P",
            "R",
            "IH0",
            "ER1",
            "N",
            "UW1",
            "B",
            "EY1",
            "AH0",
            "OW1",
            "L",
            "iǎo",
            "iě",
        ]
    )
}
LEXICON = {
    "STOP": ("S", "T", "AA1", "P"),
    "RETURN": ("R", "IH0", "T", "ER1", "N"),
    "TO": ("T", "UW1"),
    "BASE": ("B", "EY1", "S"),
}


def test_table_matches_plan_section_4_3_4():
    texts = {k.text for k in KEYWORDS}
    expected = {
        "停下",
        "站住",
        "莫动",
        "歇倒",
        "Stop",
        "Halt",
        "回巢",
        "回去充电",
        "回基地",
        "Return to base",
        "跟我走",
        "跟着我",
        "Follow me",
        "开始巡检",
        "巡一圈",
        "Start patrol",
        "小铁小铁",
    }
    assert texts == expected
    assert {k.intent for k in KEYWORDS if not k.is_wake} == set(CORE_INTENTS)
    assert [k for k in KEYWORDS if k.is_wake][0].intent == WAKE


def test_names_are_unique_and_space_free():
    names = [k.name for k in KEYWORDS]
    assert len(set(names)) == len(names)
    assert all(" " not in n for n in names)


def test_keyword_by_name_roundtrip_and_unknown():
    assert keyword_by_name("Return_to_base").intent == "RETURN_HOME"
    with pytest.raises(KeyError):
        keyword_by_name("nope")


def test_tokenize_chinese_uses_initial_and_toned_final():
    assert tokenize("停下", TOKENS, LEXICON) == ["t", "íng", "x", "ià"]


def test_tokenize_english_uses_lexicon_case_insensitively():
    assert tokenize("Stop", TOKENS, LEXICON) == ["S", "T", "AA1", "P"]
    assert tokenize("Return to base", TOKENS, {**LEXICON, "BASE": ("B", "EY1")}) == [
        "R",
        "IH0",
        "T",
        "ER1",
        "N",
        "T",
        "UW1",
        "B",
        "EY1",
    ]


def test_tokenize_rejects_unknown_word_and_unknown_token():
    with pytest.raises(ValueError, match="neither in the lexicon"):
        tokenize("Halt", TOKENS, LEXICON)
    with pytest.raises(ValueError, match="not in tokens.txt"):
        tokenize("站住", TOKENS, LEXICON)


def test_keyword_file_lines_format_and_per_keyword_tuning():
    specs = (KeywordSpec("停下", "zh", STOP), KeywordSpec("Stop", "en", STOP))
    lines = keyword_file_lines(
        specs, TOKENS, LEXICON, {"Stop": KeywordTuning(2.0, 0.1)}, KeywordTuning(1.5, 0.25)
    )
    assert lines == [
        "t íng x ià :1.5 #0.25 @停下",
        "S T AA1 P :2 #0.1 @Stop",
    ]
