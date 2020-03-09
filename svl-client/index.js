const vlSpec = {
  $schema: 'https://vega.github.io/schema/vega-lite/v4.json',
  data: {
    values: [
      { a: 'A', b: 28 },
      { a: 'B', b: 55 },
      { a: 'C', b: 43 },
      { a: 'D', b: 91 },
      { a: 'E', b: 81 },
      { a: 'F', b: 53 },
      { a: 'G', b: 19 },
      { a: 'H', b: 87 },
      { a: 'I', b: 52 }
    ]
  },
  selection: {
    select: { type: 'single' }
  },
  mark: {
    type: 'bar',
    cursor: 'pointer'
  },
  encoding: {
    x: { field: 'a', type: 'ordinal' },
    y: { field: 'b', type: 'quantitative' },
    fillOpacity: {
      condition: { selection: 'select', value: 1 },
      value: 0.3
    }
  }
};

console.log(vlSpec);

const vgSpec = vegaLite.compile(vlSpec, {}).spec;

console.log(vgSpec);

vgSpec.data.push({
  name: 'annotations',
  values: []
});

const markEncode = vgSpec.marks.find(d => d.name === 'marks').encode;

const prependFieldWithData = d => ({ ...d, field: `data.${d.field}` });
const xEncodeUpdate = prependFieldWithData(markEncode.update.x);
const yEncodeUpdate = prependFieldWithData(markEncode.update.y);

vgSpec.marks.push({
  type: 'symbol',
  from: { data: 'annotations' },
  name: 'annotationMarks',
  encode: {
    enter: {
      x: xEncodeUpdate,
      y: yEncodeUpdate,
      fill: { field: 'color' },
      size: { value: 100 },
      stroke: { value: 'red' }
    },
    update: {
      strokeWidth: { value: 0 }
    },
    hover: {
      strokeWidth: { value: 1 }
    }
  }
});

vgSpec.signals.push({
  name: 'annotationHover',
  value: {},
  on: [
    { events: '@annotationMarks:mouseover', update: 'datum' },
    { events: '@annotationMarks:mouseout', update: '{}' }
  ]
});

const marksUpdate = vgSpec.marks.find(d => d.name === 'marks').encode.update;
const defaultFillValue = marksUpdate.fill.value;
marksUpdate.fill = [
  {
    test: 'datum === annotationHover.data',
    signal: 'annotationHover.color'
  },
  { value: defaultFillValue }
];

// removes default selection signal on annotations
const selectTupleOn = vgSpec.signals.find(d => d.name === 'select_tuple').on[0];
selectTupleOn.update = selectTupleOn.update.split(' ');
selectTupleOn.update.splice(1, 0, '&& !datum._isAnnotation_');
selectTupleOn.update = selectTupleOn.update.join(' ');

const p1 = vegaEmbed('#vis1', vgSpec);
const p2 = vegaEmbed('#vis2', vgSpec);
const p3 = vegaEmbed('#vis3', vgSpec);

// makes view2 get annotation from interactions on view1 from user1
const listenToView = (view1, view2, user1, color) => {
  view1.addSignalListener('select', (name, value) => {
    const newAnnotation = [];
    if (value._vgsid_) {
      data = view2.data('data_0');
      const annotationData = data.find(d => d._vgsid_ === value._vgsid_[0]);
      newAnnotation.push({
        user: user1,
        type: 'select',
        color,
        data: annotationData,
        _isAnnotation_: true
      });
    }
    view2
      .change(
        'annotations',
        vega
          .changeset()
          .remove(d => d.user === user1)
          .insert(newAnnotation)
      )
      .run();
  });
};

Promise.all([p1, p2, p3]).then(([res1, res2, res3]) => {
  const view1 = res1.view;
  const view2 = res2.view;
  const view3 = res3.view;

  listenToView(view1, view2, 1, 'lightgreen');
  listenToView(view1, view3, 1, 'lightgreen');
  listenToView(view2, view1, 2, 'orange');
  listenToView(view2, view3, 2, 'orange');
  listenToView(view3, view1, 3, 'lightpink');
  listenToView(view3, view2, 3, 'lightpink');
});
