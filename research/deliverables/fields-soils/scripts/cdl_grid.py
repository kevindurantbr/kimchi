"""Read a CDL GeoTIFF and check its grid. Shared by select_fields.py and extract_fields.py.

Each CDL file carries its own grid. The 2022 and 2023 Sheridan County clips start one pixel east
and north of the 2021, 2024 and 2025 clips, so the origin is read from every file and never assumed.
"""
import tifffile

PIX = 30.0
# GeoKeys that every CDL file must carry: NAD83 Conus Albers (EPSG:5070 parameters), metres, PixelIsArea.
CDL_GEOKEYS = {"GTModelTypeGeoKey": 1, "GTRasterTypeGeoKey": 1, "GeographicTypeGeoKey": 4269,
               "ProjCoordTransGeoKey": 11, "ProjLinearUnitsGeoKey": 9001,
               "ProjStdParallel1GeoKey": 29.5, "ProjStdParallel2GeoKey": 45.5,
               "ProjNatOriginLatGeoKey": 23.0, "ProjNatOriginLongGeoKey": -96.0,
               "ProjFalseEastingGeoKey": 0.0, "ProjFalseNorthingGeoKey": 0.0}

def read_cdl(path):
    """Return (array, x0, y0) after checking the file's CRS GeoKeys, pixel size and tiepoint form."""
    with tifffile.TiffFile(path) as t:
        page, keys = t.pages[0], t.geotiff_metadata or {}
        bad = {k: keys.get(k) for k, v in CDL_GEOKEYS.items() if keys.get(k) != v}
        if bad: raise ValueError(f"{path}: unexpected CRS GeoKeys {bad}")
        if "ModelTransformationTag" in page.tags: raise ValueError(f"{path}: rotated/sheared grid not supported")
        sx, sy = page.tags["ModelPixelScaleTag"].value[:2]
        if (sx, sy) != (PIX, PIX): raise ValueError(f"{path}: pixel size {sx}x{sy}, expected {PIX} m")
        tie = page.tags["ModelTiepointTag"].value
        if len(tie) != 6 or tie[:3] != (0.0, 0.0, 0.0): raise ValueError(f"{path}: expected one tiepoint at pixel (0,0)")
        return page.asarray(), float(tie[3]), float(tie[4])
