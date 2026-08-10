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
        expected: {
          exitCode: 0,
          stdout: "0001|Cafe cafe\u0301 ",
          stderr: "",
        },
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
        expected: {
          exitCode: 0,
          stdout: "Content-type: text/html\n\nHello world!",
          stderr: "",
        },
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
        expected: {
          exitCode: 0,
          stdout: "\n   DEFINE.XIS\n   ----------\n   \n1/3\n2/3\n3/3",
          stderr: "",
        },
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
        expected: {
          exitCode: 0,
          stdout:
            "Test INCLUDE\n\n.Before incl2.xis\n..Inside incl2.xis\n..Before incl3.xis\n" +
            "...Inside incl3.xis\n..After incl3.xis\n..Before incl4.xis\n" +
            "...Inside incl4.xis\n...Inside incl5.xis\n.After incl2.xis",
          stderr: "",
        },
      },
    ],
  },
  {
    name: "pft-syntax-error",
    group: "errors",
    files: {
      "input.txt": { text: "one\n" },
    },
    steps: [
      {
        program: "mx",
        args: ["seq=input.txt", "pft=if p(v1) then v1/", "now"],
        expected: {
          exitCode: 1,
          stdout: "",
          stderr: "*** fmt_error=15\n\nfatal: /",
        },
      },
    ],
  },
  {
    name: "wxis-file-delete",
    group: "isisscript",
    files: {
      "delfile.xis": { source: "wxis_src/examples/delfile.xis" },
      "delete-me.txt": { text: "delete me\n" },
    },
    steps: [
      {
        program: "wxis",
        args: ["IsisScript=delfile.xis", "file=delete-me.txt"],
        inspectFiles: ["delete-me.txt"],
        expected: {
          exitCode: 0,
          stdout: "File: delete-me.txt deleted!",
          stderr: "",
          fileStates: { "delete-me.txt": false },
        },
      },
    ],
  },
  {
    name: "iso-import-and-record-read",
    group: "database",
    files: {
      "cds.iso": { source: "wxis_src/examples/cds/cds.iso" },
      "export2.xis": { source: "wxis_src/examples/cds/export2.xis" },
    },
    steps: [
      {
        program: "mx",
        args: ["iso=cds.iso", "create=cds", "now"],
        outputs: ["cds.mst", "cds.xrf"],
        compareStdout: false,
      },
      {
        program: "wxis",
        args: [
          "IsisScript=export2.xis",
          "db=cds",
          "file=two.iso",
          "type=ISO2709",
          "count=2",
        ],
        outputs: ["two.iso"],
        expected: {
          exitCode: 0,
          stdout: "000001\n000002",
          stderr: "",
        },
      },
      {
        program: "mx",
        args: ["cds", "pft=mfn(4),'|',v24/", "from=1", "count=2", "lw=0", "now"],
        expected: {
          exitCode: 0,
          stdout:
            "0001|Techniques for the measurement of transpiration of individual plants\n" +
            "0002|<The> Controlled climate in the plant chamber and its influence upon " +
            "assimilation and transpiration",
          stderr: "",
        },
      },
      {
        program: "mx",
        args: [
          "cds",
          "pft=mfn(4),'|',(v70+|;|),'|',if a(v999) then 'missing' else 'present' fi/",
          "from=1",
          "count=1",
          "lw=0",
          "now",
        ],
        expected: {
          exitCode: 0,
          stdout: "0001|Magalhaes, A.C.;Franco, C.M.|missing",
          stderr: "",
        },
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
        expected: { exitCode: 0, stdout: "", stderr: "" },
      },
      {
        program: "mx",
        args: ["cds", "bool=plants", "pft=mfn(4)/", "count=3", "lw=0", "now"],
        expected: {
          exitCode: 0,
          stdout: "       6  PLANTS\n       6  Set #000000001\nHits=6\n0001\n0004\n0011",
          stderr: "",
        },
      },
      {
        program: "wxis",
        args: [
          "IsisScript=search.xis",
          "db=cds",
          "expression=plants",
          "count=3",
        ],
        expected: {
          exitCode: 0,
          stdout: "#1: 1/6       000001\n#1: 2/6       000004\n#1: 3/6       000011",
          stderr: "",
        },
      },
      {
        program: "wxis",
        args: [
          "IsisScript=search.xis",
          "db=cds",
          "expression=plants and (",
          "count=3",
        ],
        expected: {
          exitCode: 0,
          stdout: "Syntax error: ",
          stderr: "",
        },
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
        expected: {
          exitCode: 0,
          stdout:
            "0001|Techniques for the measurement of transpiration of individual plants\n" +
            "0002|<The> Controlled climate in the plant chamber and its influence upon " +
            "assimilation and transpiration",
          stderr: "",
        },
      },
    ],
  },
];
