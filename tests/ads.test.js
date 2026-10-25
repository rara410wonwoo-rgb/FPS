import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CameraRig} from '../public/game/camera.js';
import {eyeHeight, anglesToPoint} from '../shared/aim.js';
import {moveSpeed} from '../shared/movement.js';
import {fireShot} from '../server/combat.js';
import {WEAPONS} from '../shared/config.js';
import {emptyMatch,place} from './helpers.js';

for (const crouch of [false,true]) for (const y of [0,2.5]) {
  test(`ADS camera ray and authoritative shot coincide: crouch=${crouch}, height=${y}`,()=>{
    const m=emptyMatch();const p=place(m,'A',0,0);place(m,'B',-40,-40);
    p.y=y;p.crouch=crouch;p.control.ads=true;p.control.aim=0.3;p.control.pitch=0.12;
    const rig=new CameraRig(16/9);rig.bobAmt=1;rig.trauma=1;
    rig.updateFps(1/60,p.x,p.z,p.control.aim,p.control.pitch,{ads:true,y,crouch,speed:7});
    rig.camera.updateMatrixWorld(true);
    const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,0),rig.camera);
    assert.ok(ray.ray.origin.distanceTo(new THREE.Vector3(p.x,eyeHeight(y,crouch),p.z))<1e-9);
    fireShot(m,p,p.weapons[0],WEAPONS[p.weapons[0].type]);
    const tr=m.drainEvents().find(e=>e.type==='shot').tr[0];
    assert.ok(ray.ray.distanceToPoint(new THREE.Vector3(tr.x1,tr.y1,tr.z1))<0.012);
  });
}
test('ADS does not slow normal movement for any weapon',()=>{
 for(const id of Object.keys(WEAPONS))assert.equal(moveSpeed(id,true),moveSpeed(id,false));
});
test('shoulder parallax corrects both yaw and pitch',()=>{
 const origin={x:0,y:1.62,z:0};const target={x:8,y:4,z:0.85};
 const {aim,pitch}=anglesToPoint(origin,target);
 const dir=new THREE.Vector3(Math.cos(aim)*Math.cos(pitch),Math.sin(pitch),Math.sin(aim)*Math.cos(pitch));
 assert.ok(new THREE.Ray(new THREE.Vector3(0,1.62,0),dir).distanceToPoint(new THREE.Vector3(8,4,.85))<1e-9);
});
