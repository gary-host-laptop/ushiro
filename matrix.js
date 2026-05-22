"use strict";
(function(){
	var FONT=14,FPS=18,STREAMS_PER_COL=2;
	var CHARS="アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	var canvas,ctx,cols,drops,animId,resizeTimer;
	var BG_OPAQUE="rgba(10,15,12,1)";
	var BG_FADE="rgba(10,15,12,0.15)";
	var COLOR_HEAD="#aaffaa";
	var COLOR_TRAIL="#00cc44";
	function randChar(){return CHARS[Math.floor(Math.random()*CHARS.length)];}
	function initDrops(){
		var rows=Math.floor(canvas.height/FONT);
		drops=[];
		for(var i=0;i<cols;i++){
			drops[i]=[];
			for(var s=0;s<STREAMS_PER_COL;s++){
				drops[i][s]=Math.random()<0.6
					?Math.floor(Math.random()*rows)
					:-Math.floor(Math.random()*rows*1.5);
			}
		}
	}
	function stop(){
		clearTimeout(animId);
		animId=null;
	}
	function start(){
		stop();
		canvas.width=window.innerWidth;
		canvas.height=window.innerHeight;
		cols=Math.floor(canvas.width/FONT);
		initDrops();
		// fill with opaque bg so the fade trail is visible from frame 1
		ctx.fillStyle=BG_OPAQUE;
		ctx.fillRect(0,0,canvas.width,canvas.height);
		draw();
	}
	function draw(){
		ctx.fillStyle=BG_FADE;
		ctx.fillRect(0,0,canvas.width,canvas.height);
		ctx.font=FONT+"px monospace";
		for(var i=0;i<cols;i++){
			var x=i*FONT;
			for(var s=0;s<STREAMS_PER_COL;s++){
				var y=drops[i][s]*FONT;
				if(y>0){
					ctx.fillStyle=COLOR_HEAD;ctx.fillText(randChar(),x,y);
					ctx.fillStyle=COLOR_TRAIL;ctx.fillText(randChar(),x,y-FONT);
				}
				if(y>canvas.height&&Math.random()>0.995)
					drops[i][s]=-Math.floor(Math.random()*80);
				drops[i][s]++;
			}
		}
		animId=setTimeout(function(){requestAnimationFrame(draw);},1000/FPS);
	}
	function onResize(){
		clearTimeout(resizeTimer);
		resizeTimer=setTimeout(start,150);
	}
	function init(){
		canvas=document.getElementById("matrix-rain");
		if(!canvas)return;
		ctx=canvas.getContext("2d");
		start();
		window.addEventListener("resize",onResize);
	}
	window.addEventListener("load",init);
})();
