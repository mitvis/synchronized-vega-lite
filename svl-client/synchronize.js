const colors = ['lightgreen', 'orange', 'lightpink'];

const synchronize = (vlSpec, options) => {
  console.log(vlSpec);

  let selectionName = options?.selectionName;
  let selectionType = options?.selectionType;
  const colorField = options?.colorField;

  if (!selectionName) {
    try {
      selectionName = Object.keys(vlSpec.selection)?.[0];
    } catch (e) {
      console.error(
        'Could not find selection name automatically. Please provide one!'
      );
      return;
    }
  }

  if (!selectionType) {
    try {
      selectionType = vlSpec.selection[selectionName].type;
    } catch (e) {
      console.error(
        'Could not find selection type automatically. Please provide one!'
      );
    }
  }

  // compile to vega
  const vgSpec = vegaLite.compile(vlSpec, {}).spec;

  console.log(vgSpec);

  // add data source for annotations
  vgSpec.data.push({
    name: 'annotations',
    values: [],
  });

  const recursiveMarks = (marks) => {
    if (!marks) {
      return [];
    }
    return marks.flatMap((mark) =>
      mark.type === 'group' ? recursiveMarks(mark.marks) : mark
    );
  };

  const allMarks = recursiveMarks(vgSpec.marks);

  // set up for adding the annotation marks
  const interactiveMark = allMarks.find(
    (d) => d.name.endsWith('marks') && d.interactive
  );
  if (!interactiveMark) {
    console.error('No interactive mark found!');
    return;
  }
  const markEncode = interactiveMark.encode;

  // get the encodings for x and y, modify them to access them in a different way
  const prependFieldWithData = (d, offset) => ({
    ...d,
    field: `data[0].${d.field}`,
    offset,
  });
  const xEncodeUpdate =
    selectionType === 'interval'
      ? { field: 'x' }
      : prependFieldWithData(markEncode.update.x, 8);
  const yEncodeUpdate =
    selectionType === 'interval'
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
        stroke: { value: 'red' },
      },
      update: {
        strokeWidth: { value: 0 },
        opacity: { value: 0.6 },
      },
      hover: {
        strokeWidth: { value: 0.5 },
        opacity: { value: 1 },
      },
    },
  });

  // add signal for annotation interaction
  vgSpec.signals.push({
    name: 'annotationHover',
    value: {},
    on: [
      { events: '@annotationMarks:mouseover', update: 'datum' },
      { events: '@annotationMarks:mouseout', update: '{}' },
    ],
  });

  // logic for visualization encoding updates on annotation hover
  if (selectionType === 'interval') {
    const brushBGName = selectionName + '_brush_bg';
    const brushBGEnter = allMarks.find((m) => m.name === brushBGName).encode
      .enter;
    prevFill = brushBGEnter.fill;
    brushBGEnter.fill = [
      {
        test: 'annotationHover.color',
        signal: 'annotationHover.color',
      },
      prevFill,
    ];
  } else if (colorField) {
    const prevField = markEncode.update[colorField];
    if (prevField === undefined) {
      throw `colorField ('${colorField}') is not defined in converted Vega specification!`;
    }
    markEncode.update[colorField] = [
      {
        test: 'annotationHover.color',
        signal: 'annotationHover.color',
      },
      prevField,
    ];
  }

  // signal for holding temporary state
  vgSpec.signals.push({
    name: 'tempState',
    value: {},
  });

  if (selectionType !== 'interval') {
    // removes default selection signal on annotations
    const selectTupleOn = vgSpec.signals.find(
      (d) => d.name === selectionName + '_tuple'
    ).on[0];
    selectTupleOn.update = selectTupleOn.update.split(' ');
    selectTupleOn.update.splice(1, 0, '&& !datum._isAnnotation_');
    selectTupleOn.update = selectTupleOn.update.join(' ');
  }

  const p1 = vegaEmbed('#vis1', vgSpec);
  const p2 = vegaEmbed('#vis2', vgSpec);
  const p3 = vegaEmbed('#vis3', vgSpec);

  // makes view2 get annotation from interactions on view1 from user1
  const listenToView = (view1, view2, user1, color) => {
    view1.addSignalListener(selectionName, (name, value) => {
      const hovering = view1.signal('annotationHover');
      if (hovering.selectState) {
        // don't update other views when select state is modified by annotation interaction
        return;
      }
      const newAnnotation = [];
      if (selectionType === 'interval') {
        if (Object.keys(value).length) {
          const selectState = view1.getState({
            signals: (name) =>
              name.startsWith(selectionName) &&
              !name.includes('translate') &&
              !name.includes('zoom'), // transferring translation/zoom signals causes issues with vega
            data: (name) => name.startsWith(selectionName),
          });

          // The "brush_x" signal exists either in the root signals or in a nested signal,
          // thus all the extended logic here.
          // Falls back to 0,0 if nothing else found.
          const x =
            selectState.signals[selectionName + '_x']?.[0] ||
            selectState.subcontext?.find(
              (ctx) => ctx.signals[selectionName + '_x']
            )?.signals[selectionName + '_x']?.[0] ||
            0;
          const y =
            selectState.signals[selectionName + '_y']?.[0] ||
            selectState.subcontext?.find(
              (ctx) => ctx.signals[selectionName + '_x']
            )?.signals[selectionName + '_y']?.[0] ||
            0;

          newAnnotation.push({
            user: user1,
            name: selectionName,
            color,
            x,
            y,
            selectState,
            _isAnnotation_: true,
          });
        }
      } else {
        if (value._vgsid_) {
          const selectState = view1.getState({
            signals: (name) => name.startsWith(selectionName),
            data: (name) => name.startsWith(selectionName),
          });
          data = view2.data('data_0'); // TODO: make this not sketchy?
          const annotationData = data.filter((d) =>
            value._vgsid_.includes(d._vgsid_)
          );
          newAnnotation.push({
            user: user1,
            name: selectionName,
            color,
            data: annotationData,
            selectState,
            _isAnnotation_: true,
          });
        }
      }
      if (newAnnotation) {
        view2
          .change(
            'annotations',
            vega
              .changeset()
              .remove((d) => d.user === user1)
              .insert(newAnnotation)
          )
          .run();
      }
    });
  };

  Promise.all([p1, p2, p3]).then((res) => {
    const users = res.map((resi, i) => ({
      id: i,
      view: resi.view,
      color: colors[i],
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
            signals: (name) =>
              name.startsWith(selectionName) &&
              !name.includes('translate') &&
              !name.includes('zoom'), // transferring translation/zoom signals causes issues with vega
            data: (name) => name.startsWith(selectionName),
          });
          view.signal('tempState', selectState);
          view.setState(value.selectState);
        } else {
          const tempState = view.signal('tempState');
          view.signal('tempState', {});
          view.setState(tempState);
        }
      });
    }
  });
};
