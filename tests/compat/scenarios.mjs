export const scenarios = [
  {
    name: "pft-utf8-sequence",
    group: "pft",
    files: {
      "utf8.txt": {
        text: "Cafe cafe\u0301 | Acao | \u65e5\u672c\u8a9e\n",
      },
    },
    steps: [
      {
        program: "mx",
        args: ["seq=utf8.txt", "pft=mfn(4),'|',v1/", "now"],
      },
    ],
  },
  {
    name: "wxis-hello",
    group: "isisscript",
    files: {
      "hello.xis": { source: "wxis_src/examples/hello.xis" },
    },
    steps: [
      {
        program: "wxis",
        args: ["IsisScript=hello.xis"],
      },
    ],
  },
  {
    name: "wxis-define-loop",
    group: "isisscript",
    files: {
      "define.xis": { source: "wxis_src/examples/define.xis" },
    },
    steps: [
      {
        program: "wxis",
        args: ["IsisScript=define.xis"],
      },
    ],
  },
  {
    name: "iso-import-and-record-read",
    group: "database",
    files: {
      "cds.iso": { source: "wxis_src/examples/cds/cds.iso" },
    },
    steps: [
      {
        program: "mx",
        args: ["iso=cds.iso", "create=cds", "now"],
        outputs: ["cds.mst", "cds.xrf"],
        compareStdout: false,
      },
      {
        program: "mx",
        args: ["cds", "pft=mfn(4),'|',v24/", "from=1", "count=2", "lw=0", "now"],
      },
    ],
  },
];
