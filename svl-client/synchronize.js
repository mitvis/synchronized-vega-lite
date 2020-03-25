const synchronize = (vlSpec, stroke) => {
  console.log(vlSpec);

  const selectType = vlSpec.selection.select.type;

  // compile to vega
  const vgSpec = vegaLite.compile(vlSpec, {}).spec;

  console.log(vgSpec);

  // add data source for annotations
  vgSpec.data.push({
    name: 'annotations',
    values: []
  });

  // set up for adding the annotation marks
  const markEncode = vgSpec.marks.find(d => d.name === 'marks').encode;

  // get the encodings for x and y, modify them to access them in a different way
  const prependFieldWithData = (d, offset) => ({
    ...d,
    field: `data[0].${d.field}`,
    offset
  });
  const xEncodeUpdate = prependFieldWithData(markEncode.update.x, 8);
  const yEncodeUpdate = prependFieldWithData(markEncode.update.y, -8);

  // add marks for annotations
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
        strokeWidth: { value: 0 },
        opacity: { value: 0.75 }
      },
      hover: {
        strokeWidth: { value: 0.5 },
        opacity: { value: 1 }
      }
    }
  });

  // add signal for annotation interaction
  vgSpec.signals.push({
    name: 'annotationHover',
    value: {},
    on: [
      { events: '@annotationMarks:mouseover', update: 'datum' },
      { events: '@annotationMarks:mouseout', update: '{}' }
    ]
  });

  if (!stroke) {
    // modifies fill behavior of marks based on annotation signal
    const marksUpdate = vgSpec.marks.find(d => d.name === 'marks').encode
      .update;
    const defaultFillValue = marksUpdate.fill.value;
    marksUpdate.fill = [
      {
        test:
          'annotationHover.data && indexof(annotationHover.data, datum) >= 0',
        signal: 'annotationHover.color'
      },
      { value: defaultFillValue }
    ];
  } else {
    // modifies stroke behavior of marks based on annotation signal
    const marksEncode = vgSpec.marks.find(d => d.name === 'marks').encode;
    const defaultStroke =
      marksEncode.update?.stroke || marksEncode.enter?.stroke;
    const defaultStrokeWidth = marksEncode.update?.strokeWidth ||
      marksEncode.enter?.strokeWidth || { value: 2 };

    marksEncode.update.stroke = [
      {
        test:
          'annotationHover.data && indexof(annotationHover.data, datum) >= 0',
        signal: 'annotationHover.color'
      },
      defaultStroke
    ];

    marksEncode.update.strokeWidth = [
      {
        test:
          'annotationHover.data && indexof(annotationHover.data, datum) >= 0',
        value: 2
      },
      defaultStrokeWidth
    ];
  }

  if (selectType !== 'interval') {
    // removes default selection signal on annotations
    const selectTupleOn = vgSpec.signals.find(d => d.name === 'select_tuple')
      .on[0];
    selectTupleOn.update = selectTupleOn.update.split(' ');
    selectTupleOn.update.splice(1, 0, '&& !datum._isAnnotation_');
    selectTupleOn.update = selectTupleOn.update.join(' ');
  }

  const p1 = vegaEmbed('#vis1', vgSpec);
  const p2 = vegaEmbed('#vis2', vgSpec);
  const p3 = vegaEmbed('#vis3', vgSpec);

  // makes view2 get annotation from interactions on view1 from user1
  const listenToView = (view1, view2, user1, color) => {
    view1.addSignalListener('select', (name, value) => {
      const newAnnotation = [];
      if (value._vgsid_) {
        data = view2.data('data_0');
        const annotationData = data.filter(d =>
          value._vgsid_.includes(d._vgsid_)
        );
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
};
