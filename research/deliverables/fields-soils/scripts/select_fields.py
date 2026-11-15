"""Score PLSS quarter sections inside the SD-6 boundary for a pivot-like CDL pattern."""
import json, sys, tifffile, numpy as np
from pyproj import Transformer
from shapely.geometry import shape, Point, box
from shapely.ops import transform, unary_union
YEARS=range(2021,2026)
CROPS={1:'Corn',4:'Sorghum',24:'Winter Wheat'}
CULT={1,4,5,6,21,23,24,26,27,28,36,61,205,225,226,236,238,240,254}
to5070=Transformer.from_crs(4326,5070,always_xy=True).transform
lema=transform(to5070, unary_union([shape(f['geometry']) for f in json.load(open('src/sd6_lema_boundary.geojson'))['features']]))
secs=json.load(open('src/plss_sections.geojson'))['features']
X0,Y0=-404205.0,1848555.0
rasters={y:tifffile.imread(f'raw/cdl_{y}_20179.tif') for y in YEARS}
H,W=rasters[2021].shape
def pix_in(geom):
    minx,miny,maxx,maxy=geom.bounds
    c0,c1=int((minx-X0)//30),int((maxx-X0)//30)+1; r0,r1=int((Y0-maxy)//30),int((Y0-miny)//30)+1
    out=[]
    for r in range(max(r0,0),min(r1,H)):
        for c in range(max(c0,0),min(c1,W)):
            if geom.contains(Point(X0+30*c+15, Y0-30*r-15)): out.append((r,c))
    return out
R=396  # m, typical full-circle pivot on a quarter section (approximate)
cands=[]
for f in secs:
    s=transform(to5070, shape(f['geometry']))
    if not lema.contains(s.buffer(-5)): continue
    minx,miny,maxx,maxy=s.bounds; mx,my=(minx+maxx)/2,(miny+maxy)/2
    for q,(qx0,qy0,qx1,qy1) in {'NW':(minx,my,mx,maxy),'NE':(mx,my,maxx,maxy),'SW':(minx,miny,mx,my),'SE':(mx,miny,maxx,my)}.items():
        qb=box(qx0,qy0,qx1,qy1).intersection(s); cx,cy=qb.centroid.x,qb.centroid.y
        circ=Point(cx,cy).buffer(R,64); corners=qb.difference(circ)
        pc=pix_in(circ); pk=pix_in(corners)
        if not pc: continue
        dom=[];cult_circ=[];cult_corn=[]
        for y in YEARS:
            a=rasters[y]; vc=np.array([a[r,c] for r,c in pc]); vk=np.array([a[r,c] for r,c in pk]) if pk else np.array([0])
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
