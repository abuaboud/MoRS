"""Swap Jagex's RSA login modulus in a RuneLite jar for a private server's.

usage: python3 tools/patch_rsa.py <in.jar> <out.jar> <modulus-hex-file>
"""
import re
import sys
import zipfile

src, dst, key_file = sys.argv[1:4]
modulus = re.search(rb"(?i)modulus:\s*([0-9a-f]+)", open(key_file, "rb").read())
modulus = modulus.group(1) if modulus else open(key_file, "rb").read().strip()
assert len(modulus) == 256, f"expected a 1024-bit modulus, got {len(modulus)} hex chars"

# ponytail: the modulus is the only 256-char hex CONSTANT_Utf8 (tag 1, len 0x0100) in the gamepack;
# if a future revision adds another, match the old modulus value instead.
pattern = re.compile(rb"\x01\x01\x00[0-9a-f]{256}")
hits = 0
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename.endswith(".class") and pattern.search(data):
            data, n = pattern.subn(b"\x01\x01\x00" + modulus, data)
            hits += n
            print(f"patched {item.filename}")
        zout.writestr(item, data)
assert hits == 1, f"expected exactly 1 modulus constant, found {hits}"
