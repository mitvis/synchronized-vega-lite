const vlSpec = {
  $schema: "https://vega.github.io/schema/vega-lite/v4.json",
  data: {
    values: [
      { a: "A", b: 28 },
      { a: "B", b: 55 },
      { a: "C", b: 43 },
      { a: "D", b: 91 },
      { a: "E", b: 81 },
      { a: "F", b: 53 },
      { a: "G", b: 19 },
      { a: "H", b: 87 },
      { a: "I", b: 52 }
    ]
  },
  selection: {
    select: { type: "single" }
  },
  mark: {
    type: "bar",
    cursor: "pointer"
  },
  encoding: {
    x: { field: "a", type: "ordinal" },
    y: { field: "b", type: "quantitative" },
    fillOpacity: {
      condition: { selection: "select", value: 1 },
      value: 0.3
    }
  }
};

console.log(vlSpec);

const vgSpec = vegaLite.compile(vlSpec, {}).spec;

console.log(vgSpec);

const data = vgSpec.data.find(e => e.name === "source_0").values;
console.log(data);

vgSpec.data.push({
  name: "annotations",
  values: []
});

const markEncode = vgSpec.marks.find(d => d.name === "marks").encode;
console.log(markEncode);

const prependFieldWithData = d => ({ ...d, field: `data.${d.field}` });
const xEncodeUpdate = prependFieldWithData(markEncode.update.x);
const yEncodeUpdate = prependFieldWithData(markEncode.update.y);

vgSpec.marks.push({
  type: "symbol",
  from: { data: "annotations" },
  name: "annotation",
  encode: {
    enter: {
      x: xEncodeUpdate,
      y: yEncodeUpdate,
      fill: { field: "color" },
      size: { value: 100 },
      stroke: { value: "red" }
    },
    update: {
      strokeWidth: { value: 0 }
    },
    hover: {
      strokeWidth: { value: 1 }
    }
  }
});

const p1 = vegaEmbed("#vis1", vgSpec);
const p2 = vegaEmbed("#vis2", vgSpec);

// makes view2 get annotation from interactions on view1 from user1
const listenToView = (view1, view2, user1, color) => {
  view1.addSignalListener("select", (name, value) => {
    const newAnnotation = [];
    if (value._vgsid_) {
      const vegaIdSymbol = Object.getOwnPropertySymbols(data[0])[0];
      const annotationData = data.find(d => d[vegaIdSymbol] === value._vgsid_[0]);
      newAnnotation.push({
        user: user1,
        type: "select",
        color,
        data: annotationData
      });
    }
    view2.change("annotations", vega.changeset().remove(d => d.user === user1).insert(newAnnotation)).run();
  });
}

Promise.all([p1,p2]).then(([res1, res2]) => {
  const view1 = res1.view;
  const view2 = res2.view;

  listenToView(view1, view2, 1, "lightgreen");
  listenToView(view2, view1, 2, "orange");
});
