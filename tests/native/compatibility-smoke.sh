#!/usr/bin/env sh
set -eu

mx=$1
wxis=$2
root=$3
work=${TMPDIR:-/tmp}/cisis-compatibility-$$
db=$work/cds

cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$work"

"$mx" "iso=$root/wxis_src/examples/cds/cds.iso" "create=$db" now >/dev/null

actual=$("$mx" "$db" "pft=mfn(4),'|',v24/" from=1 count=2 lw=0 now)
expected="0001|Techniques for the measurement of transpiration of individual plants
0002|<The> Controlled climate in the plant chamber and its influence upon assimilation and transpiration"

if [ "$actual" != "$expected" ]; then
  printf '%s\n' "MX PFT output did not match." >&2
  printf '%s\n' "Expected:" "$expected" "Actual:" "$actual" >&2
  exit 1
fi

hello=$("$wxis" "IsisScript=$root/wxis_src/examples/hello.xis")
case "$hello" in
  *"Content-type: text/html"*"Hello world!"*) ;;
  *)
    printf '%s\n' "WXIS hello output did not match." "$hello" >&2
    exit 1
    ;;
esac
