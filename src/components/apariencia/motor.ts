/**
 * Motor de escenas de fondo: un solo contexto WebGL2 que pinta cada escena y
 * la copia al canvas 2D de quien la pide, como el `GLR` del diseño.
 *
 * Importarlo no toca el navegador: el contexto se crea en la primera llamada
 * a `pintar`. Sin WebGL2 pinta un degradado 2D con los colores del tono.
 *
 * El fragment shader es el del diseño con solo las seis escenas de la
 * plataforma (bruma, cristal, halo, calma, flujo y duna) y las funciones que
 * usan. El `main` (viñeta, velo de lectura, desvanecido y grano) va completo.
 */
import {
  COLOR_DESVANECIDO,
  coloresDe,
  hex2,
  INDICE_SHADER,
  tonoDeEscena,
  type ClaveEscena,
  type ClaveTema,
  type ClaveTono,
} from "./catalogo";

export const VS = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;

export const FS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform int uTex;
uniform vec3 uDeep,uBase,uLite,uHigh,uMetal;
uniform vec2 uL; uniform float uTime,uFade,uFy,uGrain; uniform vec3 uFadeC; uniform vec4 uScr; uniform vec2 uScrK;
out vec4 outColor;
#define PI 3.14159265
float A,PX,ang; vec2 FC;
float hash(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
 return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y)*2.-1.;}
const mat2 RM=mat2(1.6,1.2,-1.2,1.6);
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*vn(p);p=RM*p+vec2(3.1,1.7);a*=.5;}return s;}
float fbm3(vec2 p){float s=0.,a=.5;for(int i=0;i<3;i++){s+=a*vn(p);p=RM*p+vec2(3.1,1.7);a*=.5;}return s;}
float g2(float x,float w){return exp(-(x*x)/(w*w));}
float spow(float x,float y){return pow(max(abs(x),1e-7),y);}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
vec3 ramp(float t){t=clamp(t,0.,1.);
 if(t<.38)return mix(uDeep,uBase,t/.38);
 if(t<.72)return mix(uBase,uLite,(t-.38)/.34);
 return mix(uLite,uHigh,(t-.72)/.28);}
vec3 metalize(vec3 c,float k){return mix(vec3(dot(c,vec3(.3,.55,.15))),c,k);}
/* v6 · Bruma: capas de niebla con luz volumétrica, abstracta y en calma */
vec3 sBruma(vec2 p){
  vec2 lp=vec2(.30+uL.x*.10,A*(.10+uL.y*.03));
  vec2 d=p-lp;float r=length(d*vec2(.8,1.25));
  float hz=A*.46;
  float L=.10+.30*exp(-r/.75)+.10*exp(-r/.16)+.16*exp(-abs(p.y-hz)/.16)*exp(-abs(p.x-lp.x)/.9);
  float a=atan(d.y,d.x);
  L+=.05*smoothstep(.5,.9,vn(vec2(a*3.,uTime*.02)))*exp(-r/.8)*smoothstep(.05,.3,r)*step(0.,d.y);
  float t=uTime*.008;
  for(int i=0;i<5;i++){float fi=float(i);
    float x=p.x+t*(1.+fi*.8)+uL.x*.015*(fi+1.)+fi*2.3;
    float top=A*(.40+fi*.12)+(fbm(vec2(x*1.1,fi*1.9))-.5)*(.10+fi*.03)+(vn(vec2(x*7.,fi*3.))-.5)*(.025+fi*.008);
    float inner=p.y-top;
    float den=smoothstep(-.006-fi*.002,.05+fi*.01,inner);
    float cl=fbm(vec2(x*3.,inner*5.)+fi*5.);
    float near=exp(-abs(p.x-lp.x)/(.55+fi*.1));
    float rim=exp(-max(inner,0.)/(.05+fi*.02));
    float far=1.-fi/5.;
    float lum=mix(.20+.10*cl,.42+.08*cl,far*.6)*(.75+.25*far)+(.30+.25*far)*rim*near-.06*fi*(1.-rim);
    L=mix(L,lum,den*(.70+.06*fi));}
  return metalize(ramp(L),.70); }
/* ===== Fondos Lever v8 =====
   p va de 0 a 1 en x y de 0 a A en y (hacia abajo). Todo se calcula en el shader, sin imágenes. */
float hair(float d,float px){return exp(-d*d/(px*px*1.6));}

/* Flujo: seda que corre en diagonal; el brillo sigue a la luz */
vec3 sFlujo(vec2 p){
 float t=uTime*.028;
 vec2 q=p+uL*vec2(.02,.015);
 float w=fbm3(q*1.15+vec2(t,-t*.7));
 float w2=fbm3(q*2.3+vec2(-t*.6,t*.5)+w*1.3);
 float v=q.x*1.35+q.y*1.75+w*1.6+w2*.45;
 float sn=sin(v*6.2832*1.05);
 float b=.5+.5*sn;
 float crest=spow(b,14.);
 float fold=spow(1.-abs(sn),3.);
 vec2 lp=vec2(.5+uL.x*.45,A*(.30+uL.y*.2));
 float lm=exp(-length((p-lp)*vec2(1.,.8))/.6);
 float L=.03+.12*b*b+.40*crest*(.35+.9*lm)+.05*fold*lm+.06*lm;
 L*=1.-.32*smoothstep(.15,1.,p.y/A*.7+(1.-p.x)*.15);
 vec3 c=ramp(L);
 c+=mix(uHigh,vec3(1.),.5)*crest*lm*.08;
 return c;}

/* Cristal: vidrio estriado; detrás, una luz cálida que se mueve despacio */
float crF(vec2 q){
 float t=uTime*.03;
 vec2 l1=vec2(.34+.12*sin(t)+uL.x*.10,A*(.26+.05*cos(t*.8))+uL.y*.06);
 vec2 l2=vec2(.90+.05*cos(t*.7),A*(.78+.03*sin(t*.9)));
 float d1=length((q-l1)*vec2(1.,.42));
 float L=.03+.34*exp(-d1/.28)+.22*exp(-d1/.08)+.14*exp(-length((q-l2)*vec2(1.,.45))/.24);
 L+=.04*fbm3(q*vec2(2.,.8)+vec2(t*.4,-t*.2));
 return L*(1.-.30*smoothstep(.35,1.,q.y/A));}
vec3 sCristal(vec2 p){
 float n=mix(13.,44.,clamp((uRes.x-500.)/2300.,0.,1.));
 float f=p.x*n,u=fract(f)-.5;
 float fw=uRes.x/n;
 float nx=u*2.;
 float L=crF(vec2(p.x-nx*1.25/n,p.y+(1.-nx*nx)*.010));
 L*=.80+.20*sqrt(max(0.,1.-nx*nx));
 float lx=-.45+uL.x*.6;
 float sp=g2(nx-lx,.10)*(.04+.45*crF(vec2(floor(f)/n+.5/n,p.y)));
 float gr=exp(-(.5-abs(u))*fw/1.1);
 L+=sp*.6-gr*(.04+.30*L);
 L+=exp(-(.5-u)*fw/2.2)*.035*step(0.,u);
 vec3 c=ramp(L);
 c+=mix(uHigh,vec3(1.),.6)*sp*.10;
 return c;}

/* Duna: dunas vistas desde el aire; cresta afilada, cara de sombra y rizos de arena con luz rasante */
float dnC(float x,float k,float t){return k*.30+.075*sin(x*2.0+k*2.3+t)+.035*sin(x*4.7-k*1.3-t*.7)+.05*fbm3(vec2(x*1.1+t*.3,k*3.7));}
vec3 sDuna(vec2 p){
 float t=uTime*.012;
 vec2 r=rot(.16)*(p-vec2(.5,A*.5))+vec2(.5,A*.5);
 float s=.30;
 float k0=floor(r.y/s);
 vec2 g=vec2(0.);float dmin=9.;float crest=0.;
 for(int j=-1;j<=2;j++){
  float k=k0+float(j);
  float c=dnC(r.x,k,t);
  float e=.002;float dc=(dnC(r.x+e,k,t)-dnC(r.x-e,k,t))/(2.*e);
  float d=r.y-c;
  float hk,sl;
  if(d>=0.){hk=exp(-d/.20);sl=-hk/.20;dmin=min(dmin,d);}else{hk=exp(d/.07);sl=hk/.07;}
  g+=sl*vec2(-dc,1.);
  crest=max(crest,exp(-abs(d)*uRes.x/2.2)*step(0.,d));
 }
 float rf=mix(150.,230.,clamp((uRes.x-500.)/2300.,0.,1.));
 float ph=dmin*rf+fbm3(r*vec2(4.,7.)+3.)*4.+fbm3(r*vec2(16.,3.))*1.2;
 float rp=cos(ph)*smoothstep(0.,.03,dmin)*(.35+.65*exp(-dmin/.20));
 vec3 n=normalize(vec3(-g*.05,1.)+vec3(0.,rp*.09,0.));
 vec3 Ld=normalize(vec3(-.45+uL.x*.35,.70+uL.y*.25,.34));
 float lam=dot(n,Ld);
 float L=.045+.26*smoothstep(-.45,.95,lam);
 L+=.10*spow(clamp(lam,0.,1.),4.);
 L+=crest*.10;
 L*=1.-.18*smoothstep(.2,1.,p.y/A);
 vec3 c=ramp(L);
 c+=mix(uHigh,vec3(1.),.5)*(spow(clamp(lam,0.,1.),10.)*.04+crest*.06);
 return c;}

/* Halo: el gran círculo de Lever en eclipse; un filo de luz recorre su borde */
vec3 sHalo(vec2 p){
 float S=min(1.,A*.95);
 vec2 C=vec2(.80+uL.x*.012,A*.20+uL.y*.01);
 float R=.46*S;
 vec2 d=p-C;float r=length(d);float a=atan(d.y,d.x);
 float px=1./uRes.x;
 float t=uTime*.05;
 float la=2.35+uL.x*.5+.25*sin(t);
 float dir=.5+.5*cos(a-la);
 float rim=hair(r-R,px*1.6+.0015*dir);
 float cor=exp(-max(r-R,0.)/(.05+.10*dir))*(1.-smoothstep(R-px,R+px,r)*0.)*step(R,r);
 float inside=1.-smoothstep(R-px*1.5,R+px*1.5,r);
 float L=.045+.07*exp(-length(p-vec2(.25,A*.75))/.6);
 L+=cor*(.05+.32*spow(dir,3.));
 L=mix(L,.015+.05*spow(dir,2.)*smoothstep(R*.55,R,r),inside);
 L+=rim*(.12+.85*spow(dir,4.));
 vec2 C2=C+vec2(-.5,.5)*R*1.62;float R2=R*.561;
 float r2=length(p-C2);
 float a2=atan(p.y-C2.y,p.x-C2.x);float dir2=.5+.5*cos(a2-la);
 L+=hair(r2-R2,px*1.4)*(.03+.20*spow(dir2,4.))*(1.-inside);
 vec3 c=ramp(L);
 c+=mix(uHigh,vec3(1.),.5)*rim*spow(dir,8.)*.30;
 return c;}

/* Calma: un degradado limpio con una luz amplia que entra por la esquina; nada compite con tus números */
vec3 sCalma(vec2 p){
 float t=uTime*.02;
 vec2 lp=vec2(.14+uL.x*.10+.03*sin(t),-.02*A-.04+uL.y*.05);
 float d=length((p-lp)*vec2(.9,1.));
 float L=.04+.34*exp(-d/(.42+.22*min(A,1.5)))+.07*exp(-d/.16);
 vec2 lq=vec2(1.02,A*1.02);
 L+=.045*exp(-length((p-lq)*vec2(1.,.8))/.45);
 L+=.012*fbm3(p*1.3+vec2(t,-t*.6));
 return ramp(L);}
void main(){
 vec2 fc=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);FC=fc;
 vec2 p=fc/uRes.x;A=uRes.y/uRes.x;ang=atan(uL.y,uL.x);PX=uRes.x/1290.;
 vec3 c;
 if(uTex==29)c=sBruma(p);else if(uTex==32)c=sFlujo(p);else if(uTex==38)c=sCristal(p);
 else if(uTex==39)c=sDuna(p);else if(uTex==41)c=sHalo(p);else c=sCalma(p);
 float r=length(vec2(p.x-.5,(p.y-A*.42)*.62));
 c*=1.-.34*spow(clamp(r/.95,0.,1.),2.2);
 {vec2 sq=vec2(p.x,p.y/A);float se=exp(-(spow((sq.x-uScr.x)/uScr.z,2.)+spow((sq.y-uScr.y)/uScr.w,2.)));float stp=1.-smoothstep(.17,.31,sq.y);float kS=max(uScrK.x*se,uScrK.y*stp);c=dot(uFadeC,vec3(.333))>.5?mix(c,uFadeC,kS*.85):c*(1.-kS);}
 if(uFade>0.){float t=smoothstep(A*uFy,A*(uFy+.30),p.y);t=t*t*(3.-2.*t);c=mix(c,uFadeC,t*uFade);}
 c+=(hash(fc+17.)-.5)*uGrain;
 outColor=vec4(clamp(c,0.,1.),1.);
}`;

export interface Cuadro {
  readonly escena: ClaveEscena;
  readonly tema: ClaveTema;
  readonly tono: ClaveTono;
  readonly colorPropio?: string;
  /** Dirección de la luz, de -1 a 1 en cada eje. */
  readonly luz: readonly [number, number];
  /** Segundos; una escena quieta usa siempre el mismo instante. */
  readonly tiempo: number;
}

type Rgb = [number, number, number];

const UNIFORMES = [
  "uRes",
  "uTex",
  "uDeep",
  "uBase",
  "uLite",
  "uHigh",
  "uMetal",
  "uL",
  "uTime",
  "uFade",
  "uFy",
  "uGrain",
  "uFadeC",
  "uScr",
  "uScrK",
] as const;

interface Renderer {
  readonly lienzo: HTMLCanvasElement;
  dibujar(ancho: number, alto: number, cuadro: Cuadro): void;
}

const aRgb = (hex: string): Rgb => hex2(hex).map((v) => v / 255) as Rgb;
const mezclar = (a: Rgb, b: Rgb, t: number): Rgb => a.map((v, i) => v + (b[i] - v) * t) as Rgb;

/** Tema claro: el mismo material en marfil y tono pálido de la paleta, con sombras suaves y brillos blancos. */
function coloresClaros(c: Rgb[]): Rgb[] {
  return [
    mezclar([0.66, 0.71, 0.68], c[1], 0.24),
    mezclar([0.84, 0.87, 0.84], c[2], 0.12),
    mezclar([0.94, 0.955, 0.94], c[3], 0.07),
    [1, 1, 1],
    mezclar(c[4], [1, 1, 1], 0.5),
  ];
}

function crearRenderer(): Renderer | null {
  try {
    const lienzo = document.createElement("canvas");
    lienzo.width = 8;
    lienzo.height = 8;
    const gl = lienzo.getContext("webgl2", {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) return null;

    const compilar = (tipo: number, fuente: string) => {
      const shader = gl.createShader(tipo);
      if (!shader) throw new Error("No se pudo crear el shader");
      gl.shaderSource(shader, fuente);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "");
      return shader;
    };
    const programa = gl.createProgram();
    gl.attachShader(programa, compilar(gl.VERTEX_SHADER, VS));
    gl.attachShader(programa, compilar(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(programa);
    if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(programa) ?? "");
    gl.useProgram(programa);
    const u = Object.fromEntries(UNIFORMES.map((k) => [k, gl.getUniformLocation(programa, k)])) as Record<
      (typeof UNIFORMES)[number],
      WebGLUniformLocation | null
    >;
    gl.bindVertexArray(gl.createVertexArray());

    lienzo.addEventListener("webglcontextlost", (evento) => {
      evento.preventDefault();
      // El siguiente cuadro vuelve a intentarlo desde cero.
      if (renderer === activo) renderer = undefined;
    });

    const activo: Renderer = {
      lienzo,
      dibujar(ancho, alto, cuadro) {
        if (lienzo.width < ancho || lienzo.height < alto) {
          lienzo.width = Math.max(lienzo.width, ancho);
          lienzo.height = Math.max(lienzo.height, alto);
        }
        gl.viewport(0, 0, ancho, alto);
        const tono = tonoDeEscena(cuadro.escena, cuadro.tema, cuadro.tono);
        const base = coloresDe(tono, cuadro.colorPropio).colores.map(aRgb);
        // El fondo de la plataforma no lleva data-rich: en claro usa la variante 1 del diseño.
        const c = cuadro.tema === "claro" ? coloresClaros(base) : base;
        gl.uniform2f(u.uRes, ancho, alto);
        gl.uniform1i(u.uTex, INDICE_SHADER[cuadro.escena]);
        gl.uniform3fv(u.uDeep, c[0]);
        gl.uniform3fv(u.uBase, c[1]);
        gl.uniform3fv(u.uLite, c[2]);
        gl.uniform3fv(u.uHigh, c[3]);
        gl.uniform3fv(u.uMetal, c[4]);
        gl.uniform2f(u.uL, cuadro.luz[0], cuadro.luz[1]);
        gl.uniform1f(u.uTime, cuadro.tiempo);
        gl.uniform1f(u.uFade, 0);
        gl.uniform1f(u.uFy, 0.5);
        gl.uniform1f(u.uGrain, 0.014);
        gl.uniform3fv(u.uFadeC, COLOR_DESVANECIDO[cuadro.tema]);
        gl.uniform4fv(u.uScr, [0.5, 0.5, 1, 1]);
        gl.uniform2fv(u.uScrK, [0, 0]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
    return activo;
  } catch (error) {
    console.warn("WebGL2 no disponible:", error);
    return null;
  }
}

/** `undefined`: aún no se intenta; `null`: no hay WebGL2 y se usa el degradado 2D. */
let renderer: Renderer | null | undefined;

/** Pinta un cuadro de la escena en `destino`, que ya mide `ancho` × `alto` píxeles. */
export function pintar(destino: CanvasRenderingContext2D, ancho: number, alto: number, cuadro: Cuadro): void {
  if (renderer === undefined) renderer = crearRenderer();
  if (renderer) {
    renderer.dibujar(ancho, alto, cuadro);
    // WebGL dibuja desde abajo: el cuadro útil está en la franja inferior del lienzo compartido.
    destino.drawImage(renderer.lienzo, 0, renderer.lienzo.height - alto, ancho, alto, 0, 0, ancho, alto);
    return;
  }
  const c = coloresDe(tonoDeEscena(cuadro.escena, cuadro.tema, cuadro.tono), cuadro.colorPropio).colores;
  const degradado = destino.createRadialGradient(
    ancho * 0.5,
    alto * 0.15,
    0,
    ancho * 0.5,
    alto * 0.3,
    Math.max(ancho, alto) * 0.9,
  );
  degradado.addColorStop(0, c[2]);
  degradado.addColorStop(0.35, c[1]);
  degradado.addColorStop(1, "#0E0A08");
  destino.fillStyle = degradado;
  destino.fillRect(0, 0, ancho, alto);
}

/** Si el motor pinta con la GPU. Antes del primer cuadro no se sabe y devuelve `false`. */
export function usaGpu(): boolean {
  return Boolean(renderer);
}
