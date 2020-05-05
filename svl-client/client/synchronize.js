const synchronize = (selector, vlSpec, options, socket) => {
  console.log(vlSpec);

  const colorField = options?.colorField;
  const offsetX = options?.offsetX || 0;
  const offsetY = options?.offsetY || 0;
  const annotationDefinition = options?.annotationDefinition;
  const annotationLegend = options?.annotationLegend;
  const showAnnotations = options?.showAnnotations !== false;

  const DEFAULT_COLOR = 'green';
  const DEFAULT_ANNOTATION_SIZE = 100;

  // default annotation
  let annotationMark = {
    type: 'symbol',
    encode: {
      enter: {
        size: { value: DEFAULT_ANNOTATION_SIZE },
      },
    },
  };

  let nameCounter = 0;

  // helper function to find all selection definitions in the vlSpec
  const findSelections = (vlSpec) => {
    let selections = {};
    if (Object.entries(vlSpec).length === 0) {
      return {};
    }
    for (const [key, value] of Object.entries(vlSpec)) {
      if (typeof value === 'object' && value !== null) {
        if (key === 'selection') {
          // when finding a selection, add a reference to the name of the mark/group the selection is in
          if (!vlSpec.name) {
            // if the mark/group doesn't have a name, autogenerate one.
            vlSpec.name = `group_${nameCounter++}`;
          }
          const name = vlSpec.name;
          for (const [_, selectionValue] of Object.entries(value)) {
            selectionValue._svlGroupName = name;
          }
          selections = {
            ...value,
            ...selections,
          };
        } else {
          selections = {
            ...findSelections(value), // recurse
            ...selections,
          };
        }
      }
    }
    return selections;
  };

  const selections = findSelections(vlSpec);
  console.log(selections);

  if (annotationDefinition) {
    try {
      const vgAnnotation = vegaLite.compile(annotationDefinition, {}).spec;
      annotationMark = vgAnnotation.marks.find((mark) => mark.name === 'marks');
    } catch (e) {
      console.error('Cannot compile annotation definition!', e);
    }
  }

  // compile to vega
  const vgSpec = vegaLite.compile(vlSpec, {}).spec;

  console.log(vgSpec);

  vgSpec.data.push({
    name: 'svl_annotations',
    values: [],
  });

  // helper function to find all mark definition in potentially nested layout of vgSpec
  const findMarks = (marks) => {
    if (!marks) {
      return [];
    }
    return marks.flatMap((mark) =>
      mark.type === 'group' ? findMarks(mark.marks) : mark
    );
  };

  const allMarks = findMarks(vgSpec.marks);

  const annotation_hover_events = [];

  for (const [selectionName, selection] of Object.entries(selections)) {
    const selectionType = selection.type;
    const groupName = selection._svlGroupName;
    const dataName = `svl_annotations_${selectionName}`;

    // add data source for annotations
    vgSpec.data.push({
      name: dataName,
      source: 'svl_annotations',
      transform: [
        { type: 'filter', expr: `datum._svlName === '${selectionName}'` },
      ],
    });

    // set up for adding the annotation marks
    // finds the mark with the given groupName, or just the first interactive mark.
    const interactiveMark = allMarks.find((d) =>
      groupName
        ? d.name === groupName + '_marks'
        : d.name.endsWith('marks') && d.interactive
    );
    if (!interactiveMark) {
      console.error('No mark found! Please provide a correct markName.');
      return;
    }
    const markEncode = interactiveMark.encode;

    const rootGroup =
      vgSpec.marks.find((mark) => mark.name === groupName + '_group') || vgSpec;

    // insert user input offset into encoding
    const addOffset = (d, offset) => ({
      ...d,
      offset: offset || d.offset,
    });

    // for intervals, our annotation data will provide x and y values.
    // for nonintervals (single/multi), utilize the vega spec's encoding and modify it for our annotation data.
    const xEncodeUpdate =
      selectionType === 'interval'
        ? { field: '_svlx' }
        : addOffset(markEncode.update.x, offsetX);
    const yEncodeUpdate =
      selectionType === 'interval'
        ? { field: '_svly' }
        : addOffset(markEncode.update.y, offsetY);

    const annotationMarkName = `annotation_marks_${selectionName}`;

    let annotationUpdate = annotationMark.encode.update;
    let annotationHover = annotationMark.encode.hover;
    if (!annotationUpdate) {
      annotationUpdate = {
        stroke: { value: 'red' },
        strokeWidth: { value: 0 },
        opacity: { value: 0.6 },
        x: xEncodeUpdate,
        y: yEncodeUpdate,
        fill: { field: '_svlColor' },
      };
      annotationHover = {
        strokeWidth: { value: 0.5 },
        opacity: { value: 1 },
        ...annotationMark.encode.hover,
      };
    }

    const modifiedMark = {
      ...annotationMark,
      encode: {
        ...annotationMark.encode,
        update: annotationUpdate,
        hover: annotationHover,
      },
      from: { data: dataName },
      name: annotationMarkName,
    };

    // add marks for annotations
    if (showAnnotations) {
      rootGroup.marks.push(modifiedMark);
    }

    if (selectionType !== 'interval') {
      // data filtered down to selected values
      // don't need filtered data for intervals since annotations are generated based on x/y signals for the brush

      // TODO: make this less jank
      const source = vgSpec.data.find((d) => d.name === 'data_0')
        ? 'data_0'
        : 'source_0';

      vgSpec.data.push({
        name: `filtered_data_${selectionName}`,
        source,
        transform: [
          {
            type: 'filter',
            expr: `!(length(data("${selectionName}_store"))) || (vlSelectionTest("${selectionName}_store", datum))`,
          },
        ],
      });
    }

    // logic for visualization encoding updates on annotation hover
    if (selectionType === 'interval') {
      const brushBGName = selectionName + '_brush_bg';
      const brushBGEnter = allMarks.find((m) => m.name === brushBGName).encode
        .enter;
      prevFill = brushBGEnter.fill;
      brushBGEnter.fill = [
        {
          test: 'annotation_hover.color',
          signal: 'annotation_hover.color',
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
          test: 'annotation_hover.color',
          signal: 'annotation_hover.color',
        },
        prevField,
      ];
    }

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

    // events to update the annotation hover signal (only one signal for all annotation types)
    annotation_hover_events.push(
      ...[
        { events: `@${annotationMarkName}:mouseover`, update: 'datum' },
        { events: `@${annotationMarkName}:mouseout`, update: '{}' },
      ]
    );
  }

  // signal for holding temporary state
  vgSpec.signals.push({
    name: 'tempState',
    value: {},
  });

  if (annotationLegend) {
    vgSpec.signals.push({
      name: 'num_annotations',
      update: "length(data('svl_annotations'))",
    });

    vgSpec.signals.push({
      name: 'annotation_legend_pad',
      update: 'width / (num_annotations + 1)',
    });

    vgSpec.data.push({
      name: 'svl_annotations_legend',
      transform: [
        {
          type: 'sequence',
          as: '_i',
          start: 0,
          stop: { signal: 'num_annotations' },
        },
        {
          type: 'formula',
          as: 'color',
          expr: "data('svl_annotations')[datum._i]._svlColor",
        },
        {
          type: 'formula',
          as: 'x',
          expr: '(datum._i + 1) * annotation_legend_pad',
        },
        {
          type: 'formula',
          as: '_svlUser',
          expr: "data('svl_annotations')[datum._i]._svlUser",
        },
      ],
    });

    vgSpec.marks.push({
      type: 'group',
      style: 'cell',
      encode: {
        enter: {
          y: { signal: 'height', offset: 40 },
          height: { value: 0 },
          width: { signal: 'width' },
          stroke: { value: 'gray' },
          strokeWidth: { value: 0.5 },
        },
      },
    });

    vgSpec.marks.push({
      type: 'group',
      style: 'cell',
      encode: {
        enter: {
          y: { signal: 'height', offset: 65 },
          height: { value: 20 },
          width: { signal: 'width' },
          cornerRadius: { value: 5 },
        },
      },
      title: {
        text: 'Users',
      },
      marks: [
        {
          name: 'annotation_legend_marks',
          from: { data: 'svl_annotations_legend' },
          type: 'symbol',
          encode: {
            update: {
              size: { value: 100 },
              stroke: { value: 'red' },
              strokeWidth: { value: 0 },
              opacity: { value: 0.6 },
              fill: { field: 'color' },
              x: { field: 'x' },
              y: { value: 10 },
            },
            hover: {
              strokeWidth: { value: 0.5 },
              opacity: { value: 1 },
            },
          },
        },
      ],
    });

    annotation_hover_events.push(
      ...[
        { events: `@annotation_legend_marks:mouseover`, update: 'datum' },
        { events: `@annotation_legend_marks:mouseout`, update: '{}' },
      ]
    );
  }

  // add signal for annotation interaction
  vgSpec.signals.push({
    name: 'annotation_hover',
    value: {},
    on: annotation_hover_events,
  });

  console.log(vgSpec);

  vegaEmbed(selector, vgSpec).then((res) => {
    const view = res.view;
    if (!socket) {
      socket = io();
    }

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

    for (const [selectionName, selection] of Object.entries(selections)) {
      const selectionType = selection.type;

      view.addSignalListener(selectionName, (name, value) => {
        const hovering = view.signal(`annotation_hover`);
        if (hovering._svlUser) {
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
              _svlUser: socket.id,
              _svlName: selectionName,
              _svlColor: DEFAULT_COLOR,
              _svlx: x,
              _svly: y,
              _isAnnotation_: true,
            };
          } else {
            // otherwise, just pass the data of the representative marks for the interaction
            // and the mark spec will handle it from there (see mark def at top of file)
            const datum = view.data(`filtered_data_${selectionName}`)[0];
            newAnnotation = {
              _svlUser: socket.id,
              _svlName: selectionName,
              _svlColor: DEFAULT_COLOR,
              ...datum,
              _isAnnotation_: true,
            };
          }
        }
        console.debug('emitting annotation');
        socket.emit('annotation', { annotation: newAnnotation, selectionName });
      });
    }

    socket.on('annotations', (annotations) => {
      console.debug('receiving annotations');
      view
        .data(
          'svl_annotations',
          Object.values(annotations).filter(
            (a) => a._svlUser && a._svlUser !== socket.id
          )
        )
        .runAsync();
    });

    let remoteUser;

    // temporarily switch select state to remote user's selection state when interacting with annotation
    view.addSignalListener('annotation_hover', (name, value) => {
      if (value._svlUser) {
        console.debug(`requesting state from ${value._svlUser}`);
        socket.emit('requestState', value._svlUser);
        remoteUser = value._svlUser;
      } else {
        remoteUser = undefined;
        const tempState = view.signal('tempState');
        view.signal('tempState', {});
        view.setState(tempState);
      }
    });

    // Takes a name of a signal, checks whether it matches any combination of
    // any selection name followed by either '_x' or '_y'.
    const signalFilter = (name) =>
      Object.keys(selections)
        .flatMap((selectionName) => [
          selectionName,
          selectionName + '_x',
          selectionName + '_y',
        ])
        .includes(name);

    // Takes a name of a data set, checks whether it matches any selection name
    // followed by '_store' (e.g. 'click_store').
    const dataFilter = (name) =>
      Object.keys(selections)
        .map((selectionName) => selectionName + '_store')
        .includes(name);

    socket.on('stateRequest', (to) => {
      const selectState = view.getState({
        signals: signalFilter,
        data: dataFilter,
      });
      console.debug(selectState);
      const state = Flatted.stringify(selectState);
      console.debug(`sending state to ${to}`);
      socket.emit('stateResponse', { state, to });
    });

    socket.on('remoteState', (response) => {
      if (response.user === remoteUser) {
        console.debug(`got state from ${remoteUser}`);
        const remoteState = Flatted.parse(response.state);
        console.debug(remoteState);
        const selectState = view.getState({
          signals: signalFilter,
          data: dataFilter,
        });
        view.signal('tempState', selectState);
        view.setState(remoteState);
      }
    });
  });
};
