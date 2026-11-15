"""Download a small NASA POWER regional weather sample; no credentials required."""
import json
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent / "data"
PARAMS = {
    "parameters": "PRECTOTCORR,T2M,T2M_MAX,T2M_MIN",
    "community": "AG", "longitude": -100.64, "latitude": 39.36,
    "start": "20210101", "end": "20251231", "format": "JSON",
}
URL = "https://power.larc.nasa.gov/api/temporal/daily/point?" + urllib.parse.urlencode(PARAMS)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(URL, timeout=45) as response:
        raw = response.read()
    data = json.loads(raw)
    values = data["properties"]["parameter"]
    fill = data["header"]["fill_value"]
    summary = {
        "url": URL,
        "scope": "Regional weather access proof; coordinate is not a verified field or LEMA boundary",
        "requested_lon_lat": [-100.64, 39.36],
        "response_geometry": data.get("geometry"),
        "period": "2021-01-01 through 2025-12-31; not a climatological normal",
        "parameter_metadata": data.get("parameters"),
        "daily_record_counts": {k: len(v) for k, v in values.items()},
        "missing_counts": {k: sum(x == fill or x is None for x in v.values()) for k, v in values.items()},
        "fill_value": fill,
        "downloaded_at_utc": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    }
    assert all(n == 1826 for n in summary["daily_record_counts"].values()), summary
    (OUT / "power_regional_2021_2025.json").write_bytes(raw)
    (OUT / "power_provenance.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))

if __name__ == "__main__":
    main()
