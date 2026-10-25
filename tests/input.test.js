import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InputManager} from '../public/game/input.js';

globalThis.document = new EventTarget();
globalThis.window = Object.assign(new EventTarget(), {innerWidth:1280,innerHeight:720});
function setup() {
 const canvas=new EventTarget();const input=new InputManager(canvas);input.locked=true;
 const send=(target,type,button)=>{const e=new Event(type);Object.defineProperty(e,'button',{value:button});target.dispatchEvent(e)};
 return {input,down:b=>send(canvas,'mousedown',b),up:b=>send(window,'mouseup',b)};
}
test('right-held then left fires; releasing left retains ADS; repress fires again',()=>{
 const {input,down,up}=setup();down(2);down(0);
 assert.equal(input.sample().fire,true);assert.equal(input.ads,true);
 up(0);assert.equal(input.fire,false);assert.equal(input.ads,true);
 down(0);assert.equal(input.fire,true);up(2);assert.equal(input.ads,false);assert.equal(input.fire,true);
 up(0);assert.equal(input.fire,false);
});
test('left-held then right enters ADS without interrupting fire',()=>{
 const {input,down,up}=setup();down(0);down(2);
 assert.equal(input.fire,true);assert.equal(input.ads,true);
 up(2);assert.equal(input.fire,true);assert.equal(input.ads,false);
 window.dispatchEvent(new Event('blur'));assert.equal(input.fire,false);assert.equal(input.ads,false);
});
test('disabled input ignores both mouse buttons',()=>{
 const {input,down}=setup();input.locked=false;input.setEnabled(false);down(2);down(0);
 assert.equal(input.fire,false);assert.equal(input.ads,false);
});
