const colors = ['lightgreen', 'orange', 'lightpink'];

const synchronize = vlSpec => {
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
  const xEncodeUpdate =
    selectType === 'interval'
      ? { field: 'x' }
      : prependFieldWithData(markEncode.update.x, 8);
  const yEncodeUpdate =
    selectType === 'interval'
      ? { field: 'y' }
      : prependFieldWithData(markEncode.update.y, -8);

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

  // signal for holding temporary state
  vgSpec.signals.push({
    name: 'tempState',
    value: {}
  });

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
      const hovering = view1.signal('annotationHover');
      if (hovering.selectState) {
        // don't update other views when select state is modified by annotation interaction
        return;
      }
      const newAnnotation = [];
      if (selectType === 'interval') {
        if (Object.keys(value).length) {
          const selectState = view1.getState({
            signals: name => name.startsWith('select'),
            data: name => name.startsWith('select')
          });
          const x = selectState.signals.select_x?.[0] || 0;
          const y = selectState.signals.select_y?.[0] || 0;
          newAnnotation.push({
            user: user1,
            type: 'select',
            color,
            x,
            y,
            selectState,
            _isAnnotation_: true
          });
        }
      } else {
        if (value._vgsid_) {
          const selectState = view1.getState({
            signals: name => name.startsWith('select'),
            data: name => name.startsWith('select')
          });
          data = view2.data('data_0');
          const annotationData = data.filter(d =>
            value._vgsid_.includes(d._vgsid_)
          );
          newAnnotation.push({
            user: user1,
            type: 'select',
            color,
            data: annotationData,
            selectState,
            _isAnnotation_: true
          });
        }
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

  Promise.all([p1, p2, p3]).then(res => {
    const users = res.map((resi, i) => ({
      id: i,
      view: resi.view,
      color: colors[i]
    }));

    for (let i = 0; i < users.length; i++) {
      for (let j = 0; j < users.length; j++) {
        if (i === j) {
          continue;
        }
        listenToView(users[i].view, users[j].view, i, users[i].color);
      }
    }

    for (user of users) {
      const view = user.view;
      // temporarily switch select state to remote user's selection state when interacting with annotation
      view.addSignalListener('annotationHover', (name, value) => {
        if (value.selectState) {
          const selectState = view.getState({
            signals: name => name.startsWith('select'),
            data: name => name.startsWith('select')
          });
          console.log(selectState);
          view.signal('tempState', selectState);
          view.setState(value.selectState);
        } else {
          const tempState = view.signal('tempState');
          view.setState(tempState);
          view.signal('tempState', {});
        }
      });
    }
  });
};
