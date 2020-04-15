const colors = ['lightgreen', 'orange', 'lightpink'];

const synchronize = (vlSpec, options) => {
  console.log(vlSpec);

  let selectionName = options?.selectionName;
  let selectionType = options?.selectionType;
  const colorField = options?.colorField;
  const markName = options?.markName;
  const groupName = options?.groupName;
  const offsetX = options?.offsetX || 8;
  const offsetY = options?.offsetY || -8;

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
  // finds the mark with the given markName, or just the first interactive mark.
  const interactiveMark = allMarks.find((d) =>
    markName
      ? d.name === markName + '_marks'
      : d.name.endsWith('marks') && d.interactive
  );
  if (!interactiveMark) {
    console.error('No mark found! Please provide a correct markName.');
    return;
  }
  const markEncode = interactiveMark.encode;

  console.log(markEncode);

  const rootGroup = groupName
    ? vgSpec.marks.find((mark) => mark.name === groupName + '_group')
    : vgSpec;

  console.log(rootGroup);

  // get the encodings for x and y, modify them to access them in a different way
  const prependFieldWithData = (d, offset) => ({
    ...d,
    field: `data[0].${d.field}`,
    offset,
  });

  // for intervals, our annotation data will provide x and y values.
  // for nonintervals (single/multi), utilize the vega spec's encoding and modify it for our annotation data.
  const xEncodeUpdate =
    selectionType === 'interval'
      ? { field: 'x' }
      : prependFieldWithData(markEncode.update.x, offsetX);
  const yEncodeUpdate =
    selectionType === 'interval'
      ? { field: 'y' }
      : prependFieldWithData(markEncode.update.y, offsetY);

  // add marks for annotations
  rootGroup.marks.push({
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

  if (selectionType !== 'interval') {
    // data filtered down to selected values
    // don't need filtered data for intervals since annotations are generated based on x/y signals for the brush
    vgSpec.data.push({
      name: 'filtered_data',
      source: 'data_0', // TODO: make this not default
      transform: [
        {
          type: 'filter',
          expr: `!(length(data("${selectionName}_store"))) || (vlSelectionTest("${selectionName}_store", datum))`,
        },
      ],
    });
  }

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
    )?.on?.[0];
    if (selectTupleOn) {
      selectTupleOn.update = selectTupleOn.update.split(' ');
      selectTupleOn.update.splice(1, 0, '&& !datum._isAnnotation_');
      selectTupleOn.update = selectTupleOn.update.join(' ');
    }
  }

  vegaEmbed('#vis', vgSpec).then((res) => {
    const view = res.view;
    const socket = io();

    document.addEventListener('keydown', (e) => {
      if (e.key === 's') {
        console.log(
          view.getState({
            signals: (name) => name,
            data: (name) => name,
          })
        );
      }
    });

    view.addSignalListener(selectionName, (name, value) => {
      const hovering = view.signal('annotationHover');
      if (hovering.user) {
        // don't update other views when select state is modified by annotation interaction
        return;
      }
      let newAnnotation;
      if (Object.keys(value).length) {
        if (selectionType === 'interval') {
          // if interval type selection, grab x and y select signal values to pass for annotation
          const signalNames = ['_x', '_y'].map(
            (postfix) => selectionName + postfix
          );
          const selectState = view.getState({
            signals: (name) => signalNames.includes(name),
          });

          // The "brush_x" signal exists either in the root signals or in a nested signal,
          // thus all the extended logic here. Takes the first value of the brush selection.
          // Falls back to 0,0 if nothing else found.
          const [x, y] = signalNames.map(
            (signal) =>
              selectState.signals[signal]?.[0] ||
              selectState.subcontext?.find((ctx) => ctx.signals[signal])
                ?.signals[signal]?.[0] ||
              0
          );

          newAnnotation = {
            user: socket.id,
            name: selectionName,
            color: 'green',
            x,
            y,
            _isAnnotation_: true,
          };
        } else {
          // otherwise, just pass the data of the representative marks for the interaction
          // and the mark spec will handle it from there (see mark def at top of file)
          data = view.data('filtered_data');
          newAnnotation = {
            user: socket.id,
            name: selectionName,
            color: 'green',
            data,
            _isAnnotation_: true,
          };
        }
      }
      socket.emit('annotation', newAnnotation);
    });

    socket.on('annotations', (annotations) => {
      view
        .change(
          'annotations',
          vega
            .changeset()
            .remove((d) => Object.keys(annotations).includes(d.user))
            .insert(Object.values(annotations).filter((a) => a))
        )
        .runAsync();
    });

    let remoteUser;

    // temporarily switch select state to remote user's selection state when interacting with annotation
    view.addSignalListener('annotationHover', (name, value) => {
      if (value.user) {
        console.log(`requesting state from ${value.user}`);
        socket.emit('requestState', value.user);
        remoteUser = value.user;
      } else {
        remoteUser = undefined;
        const tempState = view.signal('tempState');
        view.signal('tempState', {});
        view.setState(tempState);
      }
    });

    socket.on('stateRequest', (to) => {
      const selectState = view.getState({
        signals: (name) =>
          name === selectionName + '_x' || name === selectionName + '_y',
        data: (name) => name === selectionName + '_store',
      });
      console.log(selectState);
      const state = Flatted.stringify(selectState);
      console.log(`sending state to ${to}`);
      socket.emit('stateResponse', { state, to });
    });

    socket.on('remoteState', (response) => {
      if (response.user === remoteUser) {
        console.log(`got state from ${remoteUser}`);
        const remoteState = Flatted.parse(response.state);
        console.log(remoteState);
        const selectState = view.getState({
          signals: (name) =>
            name === selectionName + '_x' || name === selectionName + '_y',
          data: (name) => name === selectionName + '_store',
        });
        view.signal('tempState', selectState);
        view.setState(remoteState);
      }
    });
  });
};
