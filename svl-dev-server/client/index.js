const socket = io();

document.querySelector('#spec-submit').addEventListener('click', (e) => {
  const spec = document.querySelector('#spec-input').value;
  const annotation = document.querySelector('#annotation-input').value;
  const showAnnotations = document.querySelector('#showAnnotations').checked;
  const annotationLegend = document.querySelector('#annotationLegend').checked;
  const remotePreviews = document.querySelector('#remotePreviews').checked;
  const options = {
    annotationDefinition: annotation && JSON.parse(annotation),
    showAnnotations,
    annotationLegend,
    remotePreviews,
  };
  console.log(options);
  socket.emit('newSpec', { spec, options });
});

let view;

socket.on('spec', async (spec) => {
  if (view) {
    view.finalize();
  }
  document.querySelector('#spec-input').value = spec.spec;
  document.querySelector('#annotation-input').value =
    JSON.stringify(spec.options.annotationDefinition, null, 2) || '';
  document.querySelector('#showAnnotations').checked =
    spec.options.showAnnotations;
  document.querySelector('#annotationLegend').checked =
    spec.options.annotationLegend;
  document.querySelector('#remotePreviews').checked =
    spec.options.remotePreviews;
  const vlSpec = JSON.parse(spec.spec);
  view = await synchronize('#vis', vlSpec, spec.options, socket);
});
