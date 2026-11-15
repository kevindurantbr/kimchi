#!/usr/bin/env python3
"""Write scenario_parity.json: prototype/compare.py results for SYNTHETIC scenarios.

interface/test_scenario.mjs checks that interface/scenario.mjs gives the same states,
reasons and errors. Every scenario here is a made-up test input, never a farm record or a
local agronomic cutoff. Run from anywhere; --check fails if the committed file is stale.
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "prototype"))
import compare  # noqa: E402

NOTE = "SYNTHETIC test input; not a planting cutoff"
WHEAT_LATE = {"candidate_id": "corn_wheat", "kind": "calendar", "confirmed": True, "evidence": NOTE,
              "earliest_sowing_date": "2027-10-15", "validated_window_end": "2027-10-01",
              "no_feasible_adjustment": True}
SORGHUM_PLANTBACK = {"candidate_id": "corn_sorghum", "kind": "plantback", "confirmed": True,
                     "evidence": NOTE, "conflict": True}
EXCLUDING = {"synthetic": True, "constraints": [WHEAT_LATE, SORGHUM_PLANTBACK]}

CASES = [
    ("no_inputs", "fld01", "water", None),
    ("missing_inputs_stay_unresolved", "fld01", "water", {"synthetic": True, "constraints": [
        dict(WHEAT_LATE, confirmed=False),
        dict(WHEAT_LATE, evidence="  \n\t"),
        {"candidate_id": "corn_wheat", "kind": "calendar", "evidence": NOTE},
        {"candidate_id": "corn_sorghum", "kind": "plantback", "confirmed": True, "conflict": True},
        {"candidate_id": "corn_corn", "kind": "calendar", "confirmed": False, "evidence": NOTE,
         "earliest_sowing_date": "not a date"}]}),
    ("confirmed_conflicts_exclude_only_their_candidates", "fld01", "water", EXCLUDING),
    ("supplied_not_synthetic_status", "fld01", "water", {"constraints": [WHEAT_LATE]}),
    ("late_but_adjustable_or_on_time_is_not_excluded", "fld01", "water", {"synthetic": True, "constraints": [
        dict(WHEAT_LATE, no_feasible_adjustment=False),
        dict(WHEAT_LATE, earliest_sowing_date="2027-10-01"),
        dict(SORGHUM_PLANTBACK, conflict=False)]}),
    ("excluded_and_unresolved_together", "fld02", "water", {"synthetic": True, "constraints": [
        WHEAT_LATE, dict(SORGHUM_PLANTBACK, candidate_id="corn_wheat", confirmed=False)]}),
    ("priority_soil_does_not_override_constraints", "fld02", "soil", EXCLUDING),
    ("priority_operations_does_not_override_constraints", "fld03", "operations", EXCLUDING),
    # compare() has no baseline input; the interface keeps a confirmed baseline in UI state only.
    ("confirmed_baseline_is_ui_only", "fld01", "water", EXCLUDING),
    ("error_unknown_priority", "fld01", "yield", None),
    ("error_unknown_field", "test01", "water", None),
    ("error_baseline_is_not_a_scenario_field", "fld01", "water", {"synthetic": True, "baseline": "corn_corn"}),
    ("error_synthetic_not_boolean", "fld01", "water", {"synthetic": "yes"}),
    ("error_constraints_not_list", "fld01", "water", {"constraints": None}),
    ("error_unknown_candidate", "fld01", "water", {"constraints": [dict(WHEAT_LATE, candidate_id="typo")]}),
    ("error_unknown_kind", "fld01", "water", {"constraints": [dict(WHEAT_LATE, kind="water")]}),
    ("error_confirmed_not_boolean", "fld01", "water", {"constraints": [dict(WHEAT_LATE, confirmed="true")]}),
    ("error_evidence_not_text", "fld01", "water", {"constraints": [dict(WHEAT_LATE, evidence=None)]}),
    ("error_confirmed_calendar_needs_a_valid_date", "fld01", "water",
     {"constraints": [dict(WHEAT_LATE, validated_window_end="2027-13-01")]}),
    ("error_confirmed_calendar_needs_both_dates", "fld01", "water",
     {"constraints": [{k: v for k, v in WHEAT_LATE.items() if k != "validated_window_end"}]}),
]
# Messages raised by compare.require() inside compare(); JS must match them exactly.
VALIDATION = {"Unknown priority", "Unknown field_id", "Unknown scenario field", "synthetic must be boolean",
              "constraints must be a list", "Unknown candidate in constraint", "Unknown constraint kind",
              "confirmed must be boolean", "evidence must be text"}


CONSTANT = ("priority_explanation", "numeric_outputs", "numeric_status")


def project(result, constants):
    """The parts of compare() output that depend on the inputs; constant fields are checked once."""
    values = {"priority_explanation": result["priority_explanation"]}
    for c in result["candidates"]:
        values.update(numeric_outputs=c["numeric_outputs"], numeric_status=c["numeric_status"])
        assert all(values[k] == constants.setdefault(k, values[k]) for k in CONSTANT), "constant output changed"
    return {"field_id": result["field"]["field_id"], "field_baseline": result["field"]["baseline"],
            "scenario_status": result["scenario_status"],
            "questions_first": [r["rule_id"] for r in result["questions_first"]], "winner": result["winner"],
            "candidates": [{k: c[k] for k in ("candidate_id", "status", "exclusion_reasons", "unresolved_constraints")}
                           for c in result["candidates"]]}


def build():
    bundle = compare.build_bundle()
    cases, constants = [], {}
    for name, field, priority, scenario in CASES:
        case = {"name": name, "field_id": field, "priority": priority, "scenario": scenario}
        try:
            case["expected"] = project(compare.compare(bundle, field, priority, scenario), constants)
        except (ValueError, KeyError, TypeError) as error:
            # Validation messages must match exactly; a missing or invalid date only needs to fail.
            message = str(error) if isinstance(error, ValueError) and str(error) in VALIDATION else None
            case["error"] = {"kind": "validation" if message else "date", "message": message}
        cases.append(case)
    return {"note": "All scenarios are SYNTHETIC test inputs generated by make_scenario_fixtures.py from "
                    "prototype/compare.py. They are not farm records or local agronomic cutoffs.",
            "priorities": compare.PRIORITIES, "constants": constants, "cases": cases}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if scenario_parity.json is stale")
    args = parser.parse_args()
    dest = HERE / "scenario_parity.json"
    data, compact = build(), lambda v: json.dumps(v, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    payload = '{"note":%s,\n"priorities":%s,\n"constants":%s,\n"cases":[\n%s\n]}\n' % (
        compact(data["note"]), compact(data["priorities"]), compact(data["constants"]),
        ",\n".join(compact(c) for c in data["cases"]))
    if args.check:
        if dest.read_text(encoding="utf-8") != payload:
            raise SystemExit("scenario_parity.json is stale; run make_scenario_fixtures.py")
        print("scenario_parity.json is current (%d cases)." % len(CASES))
    else:
        dest.write_text(payload, encoding="utf-8")
        print("Wrote", dest)


if __name__ == "__main__":
    main()
