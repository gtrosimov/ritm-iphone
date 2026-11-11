import {haversine,validateRoute} from './route-core.mjs';

// Arithmetic mean of the measurements, not a time-weighted physiological estimate.
export function heartRateInsights(record){
 const start=Number.isFinite(record.startedAt)?record.startedAt:null,end=Number.isFinite(record.finishedAt)?record.finishedAt:null;
 const readings=(record.heartRate||[]).filter(p=>Number.isFinite(p.at)&&Number.isFinite(p.bpm)&&p.bpm>=20&&p.bpm<=260&&(start===null||p.at>=start)&&(end===null||p.at<=end)).sort((a,b)=>a.at-b.at);
 const origin=start??readings[0]?.at??0;let sum=0,min=null,max=null;
 for(const p of readings){sum+=p.bpm;min=min===null?p.bpm:Math.min(min,p.bpm);max=max===null?p.bpm:Math.max(max,p.bpm);}
 return {count:readings.length,mean:readings.length?sum/readings.length:null,min,max,samples:readings.map(p=>({...p,seconds:(p.at-origin)/1000})),durationSeconds:Math.max(0,((end??readings.at(-1)?.at??origin)-origin)/1000)};
}

// Timing covers only recorded edges. Never interpolate across a pause or GPS gap.
export function kilometreSplits(points){
 const unavailable=reason=>({available:false,reason,splits:[],hasGaps:false,distanceMetres:0,seconds:0});
 try{validateRoute(points);}catch{return unavailable('invalid');}
 if(points.length<2)return unavailable('short');
 let distanceMetres=0,seconds=0,lastBoundarySeconds=0,nextKm=1000,hasGaps=false;const splits=[];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];if(a.segment!==b.segment){hasGaps=true;continue;}
  const dt=(b.at-a.at)/1000,d=haversine(a,b);
  if(dt<=0||dt>60||d/dt>12)return unavailable('timing');
  const edgeStart=distanceMetres;distanceMetres+=d;
  while(nextKm<=distanceMetres+1e-6){
   const boundarySeconds=seconds+dt*Math.min(1,Math.max(0,(nextKm-edgeStart)/d));
   splits.push({index:splits.length+1,distanceMetres:1000,seconds:boundarySeconds-lastBoundarySeconds,partial:false});
   lastBoundarySeconds=boundarySeconds;nextKm+=1000;
  }
  seconds+=dt;
 }
 if(distanceMetres<1)return unavailable('short');
 const remainder=distanceMetres-(nextKm-1000);
 if(remainder>1e-6)splits.push({index:splits.length+1,distanceMetres:remainder,seconds:seconds-lastBoundarySeconds,partial:true});
 return {available:true,splits,hasGaps,distanceMetres,seconds};
}
