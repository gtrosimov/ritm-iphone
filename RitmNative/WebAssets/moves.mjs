const stand={h:[150,48],n:[150,68],p:[150,136],le:[125,105],lh:[120,142],re:[175,105],rh:[180,142],lk:[132,173],lf:[128,213],rk:[168,173],rf:[172,213]};
const pose=(base,changes)=>({...base,...changes});
const seated=pose(stand,{h:[120,65],n:[120,84],p:[120,150],lk:[175,150],lf:[175,210],rk:[162,154],rf:[162,210],le:[148,110],lh:[175,100],re:[143,120],rh:[170,110]});
const lying={h:[62,152],n:[83,158],p:[157,158],le:[112,119],lh:[112,85],re:[106,125],rh:[106,91],lk:[190,178],lf:[191,213],rk:[181,180],rf:[182,213]};
const squatLow=pose(stand,{h:[136,103],n:[143,122],p:[115,165],lk:[168,169],lf:[162,213],rk:[154,174],rf:[150,213],le:[157,137],lh:[178,129],re:[148,139],rh:[171,134]});
const frame={
 bench:[lying,pose(lying,{le:[110,149],lh:[95,126],re:[103,154],rh:[90,132]})],
 incline:[pose(lying,{h:[80,90],n:[95,111],p:[155,170],le:[115,85],lh:[129,44],re:[112,95],rh:[122,54]}),pose(lying,{h:[80,90],n:[95,111],p:[155,170],le:[92,133],lh:[95,88],re:[105,139],rh:[108,97]})],
 pushup:[{h:[75,110],n:[96,122],p:[168,148],le:[106,158],lh:[111,206],re:[99,162],rh:[104,206],lk:[220,179],lf:[252,206],rk:[213,181],rf:[244,206]}, {h:[76,155],n:[97,163],p:[170,179],le:[126,181],lh:[111,206],re:[119,185],rh:[104,206],lk:[220,193],lf:[252,206],rk:[213,196],rf:[244,206]}],
 pulldown:[pose(seated,{le:[142,48],lh:[157,21],re:[130,50],rh:[145,21]}),pose(seated,{le:[154,117],lh:[139,88],re:[143,122],rh:[128,93]})],
 row:[pose(seated,{le:[161,103],lh:[202,112],re:[156,112],rh:[195,121]}),pose(seated,{le:[100,127],lh:[145,139],re:[94,137],rh:[138,145]})],
 squat:[pose(stand,{le:[169,96],lh:[191,110],re:[162,100],rh:[184,118]}),squatLow],
 smith:[pose(stand,{le:[119,79],lh:[137,67],re:[181,79],rh:[163,67]}),pose(squatLow,{le:[121,133],lh:[136,120],re:[172,133],rh:[157,120]})],
 lunge:[pose(stand,{p:[149,137],lk:[111,170],lf:[89,213],rk:[181,176],rf:[205,213]}),pose(stand,{h:[143,86],n:[143,105],p:[143,165],lk:[94,166],lf:[93,213],rk:[185,211],rf:[217,213],le:[122,140],lh:[119,170],re:[169,140],rh:[175,170]})],
 legcurl:[pose(seated,{lk:[175,152],lf:[221,153],rk:[169,157],rf:[216,160]}),pose(seated,{lk:[175,152],lf:[169,206],rk:[169,157],rf:[160,209]})],
 extension:[seated,pose(seated,{lf:[229,147],rf:[221,155]})],
 calf:[stand,pose(stand,{h:[150,37],n:[150,57],p:[150,125],le:[125,94],lh:[120,131],re:[175,94],rh:[180,131],lk:[132,162],lf:[128,202],rk:[168,162],rf:[172,202]})],
 shoulder:[pose(seated,{le:[86,102],lh:[84,67],re:[150,102],rh:[153,67]}),pose(seated,{le:[103,51],lh:[106,18],re:[135,51],rh:[133,18]})],
 lateral:[stand,pose(stand,{le:[105,78],lh:[60,83],re:[195,78],rh:[240,83]})],
 curl:[stand,pose(stand,{lh:[133,78],rh:[166,78]})],
 triceps:[pose(stand,{le:[136,111],lh:[173,100],re:[154,112],rh:[188,106]}),pose(stand,{le:[136,111],lh:[142,152],re:[154,112],rh:[163,153]})],
 fly:[pose(seated,{le:[71,101],lh:[52,84],re:[168,101],rh:[187,84]}),pose(seated,{le:[102,111],lh:[120,104],re:[138,111],rh:[125,104]})],
 hyper:[{h:[107,78],n:[120,96],p:[162,143],le:[135,91],lh:[117,100],re:[130,108],rh:[112,116],lk:[194,176],lf:[224,209],rk:[188,179],rf:[216,211]}, {h:[103,182],n:[119,179],p:[162,143],le:[133,165],lh:[116,161],re:[133,178],rh:[116,177],lk:[194,176],lf:[224,209],rk:[188,179],rf:[216,211]}],
 crunch:[pose(lying,{h:[58,192],n:[81,196],p:[157,198],le:[86,170],lh:[61,180],re:[95,177],rh:[68,187],lk:[190,155],lf:[220,214],rk:[181,162],rf:[213,214]}),pose(lying,{h:[82,160],n:[101,175],p:[157,198],le:[105,150],lh:[82,149],re:[113,158],rh:[89,156],lk:[190,155],lf:[220,214],rk:[181,162],rf:[213,214]})],
 situp:[pose(lying,{h:[58,192],n:[81,196],p:[157,198],le:[99,178],lh:[119,157],re:[99,185],rh:[119,165],lk:[190,155],lf:[220,214],rk:[181,162],rf:[213,214]}),pose(lying,{h:[141,106],n:[149,129],p:[157,198],le:[175,151],lh:[197,138],re:[169,161],rh:[192,149],lk:[190,155],lf:[220,214],rk:[181,162],rf:[213,214]})],
 lowerabs:[pose(lying,{le:[110,179],lh:[139,175],re:[100,184],rh:[132,180],lk:[198,142],lf:[218,179],rk:[189,149],rf:[209,185]}),pose(lying,{p:[148,147],le:[110,179],lh:[139,175],re:[100,184],rh:[132,180],lk:[142,105],lf:[184,110],rk:[136,114],rf:[178,119]})],
 abduction:[pose(stand,{le:[118,95],lh:[94,92]}),pose(stand,{le:[118,95],lh:[94,92],rk:[195,167],rf:[233,185]})],
 bridge:[pose(lying,{h:[62,186],n:[83,191],p:[157,198],le:[111,203],lh:[145,207],re:[110,197],rh:[143,202],lk:[191,152],lf:[219,214],rk:[183,159],rf:[211,214]}),pose(lying,{h:[62,186],n:[83,191],p:[151,146],le:[111,191],lh:[145,174],re:[110,184],rh:[143,166],lk:[191,152],lf:[219,214],rk:[183,159],rf:[211,214]})],
 rdl:[stand,pose(stand,{h:[92,119],n:[113,127],p:[176,140],le:[113,158],lh:[115,192],re:[128,164],rh:[131,199],lk:[160,173],lf:[162,213],rk:[174,176],rf:[177,213]})],
 plank:[{h:[71,135],n:[94,143],p:[166,165],le:[101,199],lh:[67,206],re:[108,197],rh:[79,205],lk:[216,190],lf:[249,209],rk:[210,194],rf:[240,211]}, {h:[71,135],n:[94,143],p:[166,165],le:[101,199],lh:[67,206],re:[108,197],rh:[79,205],lk:[216,190],lf:[249,209],rk:[210,194],rf:[240,211]}]
};
const body=p=>`M ${p.n} L ${p.p} M ${p.n} L ${p.le} L ${p.lh} M ${p.n} L ${p.re} L ${p.rh} M ${p.p} L ${p.lk} L ${p.lf} M ${p.p} L ${p.rk} L ${p.rf}`;
const equipment={bench:'M40 173H168 M56 173V212 M150 173V212',incline:'M65 105L153 183H190 M90 135V212 M174 183V212',pulldown:'M43 213V18H240 M215 18V213 M75 169H157 M120 169V213',row:'M63 169H147 M110 169V213 M245 100V213 M245 112H204',legcurl:'M93 104V170H181 M111 170V213',extension:'M93 104V170H181 M111 170V213',shoulder:'M89 90V171H156 M111 171V213',fly:'M90 93V171H154 M112 171V213',hyper:'M145 154L180 125 M164 146L197 213 M189 186H231',lowerabs:'M39 177H183 M60 177V214 M171 177V214',smith:'M70 213V16 M222 213V16',abduction:'M90 62V213',triceps:'M232 213V15H176 M176 15V75',calf:'M105 217H193',bridge:'M44 203H97 M56 203V216'};
export function renderMove(ex){
  const pair=Object.hasOwn(frame,ex.move)?frame[ex.move]:null;
  if(!pair)return '<div class="unknown-move"><span class="unknown-mark">?</span><b>Уточним движение</b><p>Название на листе не определяет технику. Здесь появится точная схема после уточнения.</p></div>';
  const [a,b]=pair;const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const anim=(attr,v1,v2)=>reduced?'':`<animate attributeName="${attr}" values="${v1};${v1};${v2};${v2};${v1}" keyTimes="0;0.1;0.45;0.55;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines=".4 0 .2 1;.4 0 .2 1;.4 0 .2 1;.4 0 .2 1"/>`;
  const weights=['bench','incline','shoulder','curl','lateral','rdl'].includes(ex.move)?['lh','rh'].map(k=>`<circle cx="${a[k][0]}" cy="${a[k][1]}" r="7" fill="#f2efe4">${anim('cx',a[k][0],b[k][0])}${anim('cy',a[k][1],b[k][1])}</circle>`).join(''):'';
  return `<div class="motion-stage"><svg class="motion-svg" viewBox="0 0 300 240" role="img" aria-label="Схема движения упражнения"><path d="M25 218H275" stroke="#35413b" stroke-width="2"/><path d="${equipment[ex.move]||''}" stroke="#5d6c63" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="${body(a)}" fill="none" stroke="#ccf777" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">${anim('d',body(a),body(b))}</path><circle cx="${a.h[0]}" cy="${a.h[1]}" r="13" fill="#ccf777">${anim('cx',a.h[0],b.h[0])}${anim('cy',a.h[1],b.h[1])}</circle>${weights}</svg><span class="motion-caption">СХЕМА ДВИЖЕНИЯ</span></div>`;
}
