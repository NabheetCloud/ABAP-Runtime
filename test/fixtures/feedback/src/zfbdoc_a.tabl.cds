@EndUserText.label : 'Feedback repro: documents'
define table zfbdoc_a {
  key client  : abap.clnt not null;
  key doc_id  : abap.char(10) not null;
  reference   : abap.char(20);
  doc_date    : abap.dats;
}
