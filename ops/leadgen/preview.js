const { COMPOSER_SRC } = require('./composer.js');
const rows = JSON.parse(require('fs').readFileSync('sample.json', 'utf8'));
const fn = new Function('SAMPLE', COMPOSER_SRC + `
return SAMPLE.map(function(r){
  var c = kqCompose(r);
  return '--- ' + r.business_name + '  [' + r.segment_code + ' / score ' +
         r.qualification_score + ' / variant ' + c.variant + ']\\n' +
         'SUBJECT: ' + c.subject + '\\n\\n' + c.body +
         '\\n\\n(words: ' + c.body.split(/\\s+/).length + ')\\n';
}).join('\\n' + '='.repeat(72) + '\\n');
`);
console.log(fn(rows));
