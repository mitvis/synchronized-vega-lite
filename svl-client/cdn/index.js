const DEFAULT_COLOR = 'green';
const DEFAULT_ANNOTATION_SIZE = 100;
const PREVIEW_SCALE_FACTOR = 1 / 4;

const deepClone = rfdc();

const synchronize = (selector, vlSpec, options, socket) => {
  console.log(vlSpec);

  const colorField = options?.colorField;
  const offsetX = options?.offsetX || 0;
  const offsetY = options?.offsetY || 0;
  const annotationDefinition = options?.annotationDefinition;
  const annotationLegend = options?.annotationLegend;
  const showAnnotations = options?.showAnnotations !== false;
  const remotePreviews = options?.remotePreviews;

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

  const previewVlSpec = deepClone(vlSpec);
  previewVlSpec.width = 250;
  previewVlSpec.height = 250;

  const scaleVLSpecDown = (spec) => {
    if (!spec) {
      return;
    }
    for (const [key, value] of Object.entries(spec)) {
      if (['height', 'width'].includes(key) && typeof value === 'number') {
        spec[key] = value * PREVIEW_SCALE_FACTOR;
      } else if (typeof value === 'object') {
        // arrays included
        scaleVLSpecDown(value);
      }
    }
  };

  scaleVLSpecDown(previewVlSpec);

  console.log(previewVlSpec);

  const previewSpec =
    remotePreviews && vegaLite.compile(previewVlSpec, {}).spec;
  console.log(previewSpec);

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
        strokeWidth: [
          {
            test:
              'annotation_select._svlUser && annotation_select._svlUser === datum._svlUser',
            value: 0.5,
          },
          { value: 0 },
        ],
        opacity: [
          {
            test:
              'annotation_select._svlUser && annotation_select._svlUser === datum._svlUser',
            value: 1,
          },
          { value: 0.6 },
        ],
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
        update: annotationUpdate || {},
        hover: annotationHover || {},
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
              strokeWidth: [
                {
                  test:
                    'annotation_select._svlUser && annotation_select._svlUser === datum._svlUser',
                  value: 0.5,
                },
                { value: 0 },
              ],
              opacity: [
                {
                  test:
                    'annotation_select._svlUser && annotation_select._svlUser === datum._svlUser',
                  value: 1,
                },
                { value: 0.6 },
              ],
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

  vgSpec.signals.push({
    name: 'annotation_select',
    value: {},
    on: [
      {
        events: [{ source: 'scope', type: 'click' }],
        update: 'datum && datum._svlUser ? datum : {}',
      },
    ],
  });

  console.log(vgSpec);

  const svlContainer = document.querySelector(selector);

  if (!document.querySelector('#svlVisContainer')) {
    const visContainer = document.createElement('div');
    visContainer.id = 'svlVisContainer';
    svlContainer.append(visContainer);
  }

  let peekingUser;
  let trackingUser;
  const trackers = new Set();

  if (remotePreviews) {
    if (!document.querySelector('#remotePreviewsContainer')) {
      const previews = document.createElement('div');
      previews.id = 'remotePreviewsContainer';
      previews.style.width = '100%';
      svlContainer.append(previews);
    }

    const reducePreview = (spec, isMark) => {
      if (!spec) {
        return;
      }

      delete spec['legends'];
      delete spec['axes'];
      delete spec['title'];

      if (isMark) {
        // from lyra
        const mark = spec;
        if (mark.type === 'symbol' && mark.encode?.update?.size?.value) {
          mark.encode.update.size.value *= PREVIEW_SCALE_FACTOR;
        }
        if (mark.type === 'text') {
          if (mark.encode?.update?.fontSize?.value) {
            mark.encode.update.fontSize.value /= 2;
          }
          if (mark.encode?.update?.dx?.value) {
            mark.encode.update.dx.value *= PREVIEW_SCALE_FACTOR;
          }
          if (mark.encode?.update?.dy?.value) {
            mark.encode.update.dy.value *= PREVIEW_SCALE_FACTOR;
          }
          if (mark.encode?.update?.x?.value) {
            mark.encode.update.x.value *= PREVIEW_SCALE_FACTOR;
          }
          if (mark.encode?.update?.y?.value) {
            mark.encode.update.y.value *= PREVIEW_SCALE_FACTOR;
          }
        }
        if (mark.type === 'line' && mark.encode?.update?.strokeWidth?.value) {
          mark.encode.update.strokeWidth.value /= 2;
        }
      }

      for (const [key, value] of Object.entries(spec)) {
        if (typeof value === 'object') {
          if (key === 'marks') {
            value.forEach((mark) => reducePreview(mark, true));
          } else {
            reducePreview(value);
          }
        }
      }
    };
    const cleanPreview = (previewSpec) => {
      previewSpec.scales = previewSpec.scales.map(scale => {
        if (scale.range) {
          const range = scale.range;
          // linear numeric scales
          if (Array.isArray(range) && range.length == 2 && !range.some(isNaN)) {
            scale.range = range.map(n => n / 10);
          }
          // band scales using signal ref for step
          if (range.step && range.step.signal) {
            previewSpec.signals = previewSpec.signals.map(signal => {
              if (signal.name === range.step.signal) {
                signal.value /= 2;
              }
              return signal;
            });
          }
        }
        return scale;
      });
      if (previewSpec.layout?.padding) {
        previewSpec.layout.padding /= 2;
      }
      reducePreview(previewSpec);
    }
    cleanPreview(previewSpec);
  }

  let previewViews = [];

  // helper function to handle previews
  const renderPreviews = async (annotations, socket, view) => {
    if (!remotePreviews) {
      return;
    }
    const previewsContainer = document.querySelector(
      '#remotePreviewsContainer'
    );
    annotations = Object.values(annotations);
    const uniqueUsers = new Set();
    annotations = annotations.reverse().filter((d) => {
      if (uniqueUsers.has(d._svlUser) || d._svlUser === socket.id) {
        return false;
      }
      uniqueUsers.add(d._svlUser);
      return true;
    });
    if (previewsContainer.childElementCount !== annotations.length) {
      // reset all children
      previewViews.forEach((view) => view.finalize());
      previewsContainer.textContent = '';
      const previewDivs = annotations.map((d) => {
        const div = document.createElement('div');
        div.id = 'svl_preview_' + d._svlUser;
        div.style.borderStyle = 'solid';
        div.style.borderRadius = '4px';
        div.style.marginRight = '2px';
        div.style.overflow = 'hidden';
        div.classList.add('svlPreview');
        div.setAttribute('svl_user', d._svlUser);
        return div;
      });

      previewsContainer.append(...previewDivs);
      previewViews = (
        await Promise.all(
          annotations.map((d) =>
            vegaEmbed('#svl_preview_' + d._svlUser, previewSpec, {
              actions: false,
            })
          )
        )
      ).map((res) => res.view);

      previewDivs.forEach((div) => {
        const user = div.getAttribute('svl_user');
        const overlay = document.createElement('div');
        div.append(overlay);
        overlay.style.position = 'absolute';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.opacity = trackingUser === user ? '0.1' : '0';
        overlay.classList.add('svlPreviewOverlay');
        overlay.setAttribute('svl_user', user);
        overlay.id = 'svl_preview_overlay_' + user;
      });
    }

    annotations.forEach((data, i) => {
      const previewContainer = previewsContainer.querySelector(
        '#svl_preview_' + data._svlUser
      );
      previewContainer.style.borderColor = data._svlColor;
      previewContainer.querySelector(
        '.svlPreviewOverlay'
      ).style.backgroundColor = data._svlColor;
      const preview = previewViews[i];
      if (preview) {
        preview.setState(Flatted.parse(data.state));
        preview.runAsync();
      }
    });
  };

  return vegaEmbed('#svlVisContainer', vgSpec, { actions: false }).then(
    (res) => {
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

      if (remotePreviews) {
        const previewsContainer = document.querySelector(
          '#remotePreviewsContainer'
        );
        previewsContainer.addEventListener('mouseover', (e) => {
          const el = e.target;
          if (el.classList.contains('svlPreviewOverlay')) {
            if (trackingUser) {
              return;
            }
            el.style.opacity = '0.1';
            const user = el.getAttribute('svl_user');
            console.debug(`requesting state from ${user}`);
            socket.emit('requestState', { user, track: true });
            peekingUser = user;
            const selectState = view.getState({
              signals: signalFilter,
              data: dataFilter,
            });
            view.signal('tempState', selectState);
          }
        });

        previewsContainer.addEventListener('mouseout', (e) => {
          const el = e.target;
          if (el.classList.contains('svlPreviewOverlay')) {
            if (trackingUser) {
              return;
            }
            el.style.opacity = '0';
            socket.emit('untrackState', peekingUser);
            peekingUser = undefined;
            const tempState = view.signal('tempState');
            view.signal('tempState', {});
            view.setState(tempState);
          }
        });

        document.addEventListener('click', (e) => {
          const el = e.target;
          if (el.classList.contains('svlPreviewOverlay')) {
            const user = el.getAttribute('svl_user');
            console.debug(`requesting state from ${user}`);
            socket.emit('requestState', { user, track: true });
            if (trackingUser !== user) {
              socket.emit('untrackState', trackingUser);
            }
            trackingUser = user;
            peekingUser = undefined;
          } else if (trackingUser) {
            socket.emit('untrackState', trackingUser);
            previewsContainer.querySelector(
              '#svl_preview_overlay_' + trackingUser
            ).style.opacity = 0;
            trackingUser = undefined;
          }
        });
      }

      for (const [selectionName, selection] of Object.entries(selections)) {
        const selectionType = selection.type;

        view.addSignalListener(selectionName, (name, value) => {
          if (peekingUser || trackingUser) {
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
          if (newAnnotation && remotePreviews) {
            const selectState = view.getState({
              signals: signalFilter,
              data: dataFilter,
            });
            const state = Flatted.stringify(selectState);
            newAnnotation = {
              ...newAnnotation,
              state,
            };
          }
          socket.emit('annotation', {
            annotation: newAnnotation,
            selectionName,
          });
          if (trackers.size) {
            const selectState = view.getState({
              signals: signalFilter,
              data: dataFilter,
            });
            const state = Flatted.stringify(selectState);
            socket.emit('stateResponse', { state, to: Array.from(trackers) });
          }
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
        if (remotePreviews) {
          renderPreviews(annotations, socket, view);
        }
      });

      // Takes a name of a signal, checks whether it matches any combination of
      // any selection name followed by either '_x' or '_y'.
      const signalFilter = (name) =>
        Object.keys(selections)
          .map(
            (selectionName) =>
              name.startsWith(selectionName) &&
              [...name].filter((char) => char === '_').length <= 1 // ignore complicated signals since they break intervals for some reason, TODO: Make this cleaner
          )
          .some(Boolean);

      // Takes a name of a data set, checks whether it matches any selection name
      // followed by '_store' (e.g. 'click_store').
      const dataFilter = (name) =>
        Object.keys(selections)
          .map((selectionName) => selectionName + '_store')
          .includes(name);

      // temporarily switch select state to remote user's selection state when interacting with annotation
      view.addSignalListener('annotation_hover', (name, value) => {
        if (trackingUser) {
          return;
        }
        if (value._svlUser) {
          console.debug(`requesting state from ${value._svlUser}`);
          socket.emit('requestState', { user: value._svlUser, track: true });
          peekingUser = value._svlUser;
          const selectState = view.getState({
            signals: signalFilter,
            data: dataFilter,
          });
          view.signal('tempState', selectState);
        } else {
          socket.emit('untrackState', peekingUser);
          peekingUser = undefined;
          const tempState = view.signal('tempState');
          view.signal('tempState', {});
          view.setState(tempState);
        }
      });

      view.addSignalListener('annotation_select', (name, value) => {
        if (value._svlUser) {
          console.debug(`requesting state from ${value._svlUser}`);
          socket.emit('requestState', { user: value._svlUser, track: true });
          if (trackingUser !== value.svlUser) {
            socket.emit('untrackState', trackingUser);
          }
          trackingUser = value._svlUser;
          peekingUser = undefined;
        } else if (trackingUser) {
          socket.emit('untrackState', trackingUser);
          trackingUser = undefined;
        }
      });

      socket.on('stateRequest', ({ to, track }) => {
        if (track) {
          trackers.add(to);
        }
        const selectState = view.getState({
          signals: signalFilter,
          data: dataFilter,
        });
        console.debug(selectState);
        const state = Flatted.stringify(selectState);
        console.debug(`sending state to ${to}`);
        socket.emit('stateResponse', { state, to });
      });

      socket.on('untrack', (user) => {
        trackers.delete(user);
      });

      socket.on('remoteState', (response) => {
        if (response.user === peekingUser || response.user === trackingUser) {
          console.debug(`got state from ${response.user}`);
          const remoteState = Flatted.parse(response.state);
          console.debug(remoteState);
          view.setState(remoteState);
        }
      });

      return view;
    }
  );
};
