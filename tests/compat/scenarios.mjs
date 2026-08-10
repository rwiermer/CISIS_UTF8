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
    name: "wxis-nested-includes",
    group: "isisscript",
    files: {
      "incl1.xis": { source: "wxis_src/examples/incl1.xis" },
      "incl2.xis": { source: "wxis_src/examples/incl2.xis" },
      "incl3.xis": { source: "wxis_src/examples/incl3.xis" },
      "incl4.xis": { source: "wxis_src/examples/incl4.xis" },
      "incl5.xis": { source: "wxis_src/examples/incl5.xis" },
    },
    steps: [
      {
        program: "wxis",
        args: ["IsisScript=incl1.xis"],
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
  {
    name: "fst-inversion-and-search",
    group: "search",
    files: {
      "cds.iso": { source: "wxis_src/examples/cds/cds.iso" },
      "cds.fst": { source: "wxis_src/examples/cds/cds.fst" },
      "search.xis": { source: "wxis_src/examples/cds/search.xis" },
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
        args: ["cds", "fst=@cds.fst", "fullinv=cds", "now"],
        outputs: [
          "cds.cnt",
          "cds.ifp",
          "cds.l01",
          "cds.l02",
          "cds.n01",
          "cds.n02",
        ],
      },
      {
        program: "mx",
        args: ["cds", "bool=plants", "pft=mfn(4)/", "count=3", "lw=0", "now"],
      },
      {
        program: "wxis",
        args: [
          "IsisScript=search.xis",
          "db=cds",
          "expression=plants",
          "count=3",
        ],
      },
    ],
  },
  {
    name: "wxis-iso-import-update",
    group: "database",
    files: {
      "cds.iso": { source: "wxis_src/examples/cds/cds.iso" },
      "import2.xis": { source: "wxis_src/examples/cds/import2.xis" },
    },
    steps: [
      {
        program: "wxis",
        args: [
          "IsisScript=import2.xis",
          "db=wxdb",
          "file=cds.iso",
          "type=ISO2709",
        ],
        outputs: ["wxdb.mst", "wxdb.xrf"],
      },
      {
        program: "mx",
        args: ["wxdb", "pft=mfn(4),'|',v24/", "from=1", "count=2", "lw=0", "now"],
      },
    ],
  },
];
