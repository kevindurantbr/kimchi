"""Score PLSS quarter sections inside the SD-6 boundary for a pivot-like CDL pattern."""
import json, sys, numpy as np
from cdl_grid import read_cdl
from pyproj import Transformer
from shapely.geometry import shape, Point, box
from shapely.ops import transform, unary_union
YEARS=range(2021,2026)
CROPS={1:'Corn',4:'Sorghum',24:'Winter Wheat'}
CULT={1,4,5,6,21,23,24,26,27,28,36,61,205,225,226,236,238,240,254}
to5070=Transformer.from_crs(4326,5070,always_xy=True).transform
lema=transform(to5070, unary_union([shape(f['geometry']) for f in json.load(open('src/sd6_lema_boundary.geojson'))['features']]))
secs=json.load(open('src/plss_sections.geojson'))['features']
rasters={y:read_cdl(f'raw/cdl_{y}_20179.tif') for y in YEARS}  # year -> (array, x0, y0); grids differ by year
def vals_in(geom,y):
    a,X0,Y0=rasters[y]; H,W=a.shape
    minx,miny,maxx,maxy=geom.bounds
    c0,c1=int((minx-X0)//30),int((maxx-X0)//30)+1; r0,r1=int((Y0-maxy)//30),int((Y0-miny)//30)+1
    return np.array([a[r,c] for r in range(max(r0,0),min(r1,H)) for c in range(max(c0,0),min(c1,W))
                     if geom.contains(Point(X0+30*c+15, Y0-30*r-15))])
R=396  # m, typical full-circle pivot on a quarter section (approximate)
cands=[]
for f in secs:
    s=transform(to5070, shape(f['geometry']))
    if not lema.contains(s.buffer(-5)): continue
    minx,miny,maxx,maxy=s.bounds; mx,my=(minx+maxx)/2,(miny+maxy)/2
    for q,(qx0,qy0,qx1,qy1) in {'NW':(minx,my,mx,maxy),'NE':(mx,my,maxx,maxy),'SW':(minx,miny,mx,my),'SE':(mx,miny,maxx,my)}.items():
        qb=box(qx0,qy0,qx1,qy1).intersection(s); cx,cy=qb.centroid.x,qb.centroid.y
        circ=Point(cx,cy).buffer(R,64); corners=qb.difference(circ)
        dom=[];cult_circ=[];cult_corn=[]
        for y in YEARS:
            vc=vals_in(circ,y); vk=vals_in(corners,y) if not corners.is_empty else np.array([])
            if not len(vc): dom=None; break
            if not len(vk): vk=np.array([0])
            if (vc==0).any(): dom=None; break
            v,n=np.unique(vc,return_counts=True); i=n.argmax(); dom.append((int(v[i]),n[i]/len(vc)))
            cult_circ.append(np.isin(vc,list(CULT)).mean()); cult_corn.append(np.isin(vk,list(CULT)).mean())
        if dom is None: continue
        inlib=all(d[0] in CROPS for d in dom)
        score=np.mean([d[1] for d in dom]) + 0.3*(np.mean(cult_circ)-np.mean(cult_corn))
        cands.append(dict(id=f['properties']['FRSTDIVID']+q, sec=f['properties']['FRSTDIVID'], q=q, cx=cx, cy=cy, score=float(score), inlib=inlib,
            seq=[(y,CROPS.get(d[0],str(d[0])),round(float(d[1]),2)) for y,d in zip(YEARS,dom)], circ_cult=round(float(np.mean(cult_circ)),2), corner_cult=round(float(np.mean(cult_corn)),2)))
cands.sort(key=lambda c:(-c['inlib'],-c['score']))
json.dump(cands,open('raw/candidates.json','w'),indent=1)
for c in cands[:12]: print(round(c['score'],3),c['inlib'],c['id'],c['circ_cult'],c['corner_cult'],c['seq'])
print(len(cands),'candidates')
