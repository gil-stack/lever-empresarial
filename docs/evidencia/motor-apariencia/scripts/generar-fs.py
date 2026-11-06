import sys, json
src = sys.argv[1]; destino = sys.argv[2]; salida_completo = sys.argv[3]
L = open(src, encoding='utf-8').read().split('\n')
ln = lambda a, b: L[a-1:b]  # 1-based inclusive
# VS: líneas 51-52 (sin el "const VS=`" ni el "`;")
vs = '\n'.join(ln(51, 52))
assert vs.startswith('const VS=`') and vs.endswith('`;')
vs = vs[len('const VS=`'):-2]
full = '\n'.join(ln(53, 1001))
assert full.startswith('const FS=`') and full.endswith('}`;')
full = full[len('const FS=`'):-2]
open(salida_completo, 'w', encoding='utf-8').write(json.dumps({'VS': vs, 'FS': full}))
keep = []
keep += ln(54, 61)            # precision, uniformes, salida, PI, globales, hash
keep += ln(63, 74)            # vn, RM, fbm, fbm3, g2, spow, rot, ramp (sin hash2)
keep += ln(433, 433)          # metalize (bruma)
keep += ln(834, 854)          # bruma
keep += ln(873, 987)          # hair, flujo, cristal, duna, halo, calma
main = ln(988, 1001)
assert main[0].startswith('void main(){') and main[4].startswith(' if(uTex==0)')
disp = [' if(uTex==29)c=sBruma(p);else if(uTex==32)c=sFlujo(p);else if(uTex==38)c=sCristal(p);',
        ' else if(uTex==39)c=sDuna(p);else if(uTex==41)c=sHalo(p);else c=sCalma(p);']
main = main[:4] + disp + main[7:]
main[-1] = main[-1]
fs = '\n'.join(['#version 300 es'] + keep + main)
assert fs.endswith('}`;'); fs = fs[:-2]
for s in (vs, fs):
    assert '`' not in s and '${' not in s and '\\' not in s
t = open(destino, encoding='utf-8').read()
assert t.count('`__VS__`') == 1 and t.count('`__FS__`') == 1
t = t.replace('`__VS__`', '`' + vs + '`').replace('`__FS__`', '`' + fs + '`')
open(destino, 'w', encoding='utf-8').write(t)
print('VS', len(vs), 'FS recortado', len(fs), 'líneas', fs.count('\n') + 1, '| FS completo', len(full), 'líneas', full.count('\n') + 1)
