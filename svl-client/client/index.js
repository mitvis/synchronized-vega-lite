const spec = {
  $schema: 'https://vega.github.io/schema/vega-lite/v4.json',
  title: 'Seattle Weather, 2012-2015',
  data: {
    url: 'data/seattle-weather.csv',
  },
  vconcat: [
    {
      name: 'scatter',
      encoding: {
        color: {
          condition: {
            title: 'Weather',
            field: 'weather',
            scale: {
              domain: ['sun', 'fog', 'drizzle', 'rain', 'snow'],
              range: ['#e7ba52', '#a7a7a7', '#aec7e8', '#1f77b4', '#9467bd'],
            },
            selection: 'brush',
            type: 'nominal',
          },
          value: 'lightgray',
        },
        size: {
          title: 'Precipitation',
          field: 'precipitation',
          scale: { domain: [-1, 50] },
          type: 'quantitative',
        },
        x: {
          axis: { title: 'Date', format: '%b' },
          field: 'date',
          timeUnit: 'monthdate',
          type: 'temporal',
        },
        y: {
          axis: { title: 'Maximum Daily Temperature (C)' },
          field: 'temp_max',
          scale: { domain: [-5, 40] },
          type: 'quantitative',
        },
      },
      width: 600,
      height: 300,
      mark: 'point',
      selection: { brush: { encodings: ['x'], type: 'interval' } },
      transform: [{ filter: { selection: 'click' } }],
    },
    {
      encoding: {
        color: {
          condition: {
            field: 'weather',
            scale: {
              domain: ['sun', 'fog', 'drizzle', 'rain', 'snow'],
              range: ['#e7ba52', '#a7a7a7', '#aec7e8', '#1f77b4', '#9467bd'],
            },
            selection: 'click',
            type: 'nominal',
          },
          value: 'lightgray',
        },
        x: { aggregate: 'count', type: 'quantitative' },
        y: { title: 'Weather', field: 'weather', type: 'nominal' },
      },
      width: 600,
      mark: 'bar',
      selection: { click: { encodings: ['color'], type: 'multi' } },
      transform: [{ filter: { selection: 'brush' } }],
    },
  ],
};

const socket = io();

document.querySelector('#spec-submit').addEventListener('click', (e) => {
  const spec = document.querySelector('#spec-input').value;
  const annotation = document.querySelector('#annotation-input').value;
  const showAnnotations = document.querySelector('#showAnnotations').checked;
  const annotationLegend = document.querySelector('#annotationLegend').checked;
  const options = {
    annotationDefinition: annotation && JSON.parse(annotation),
    showAnnotations,
    annotationLegend,
  };
  console.log(options);
  socket.emit('newSpec', { spec, options });
});

socket.on('spec', (spec) => {
  document.querySelector('#spec-input').value = spec.spec;
  document.querySelector('#annotation-input').value =
    spec.options.annotation || '';
  document.querySelector('#showAnnotations').checked =
    spec.options.showAnnotations;
  document.querySelector('#annotationLegend').checked =
    spec.options.annotationLegend;
  const vlSpec = JSON.parse(spec.spec);
  synchronize('#vis', vlSpec, spec.options, socket);
});
