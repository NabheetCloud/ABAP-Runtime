@EndUserText.label : 'Business partner role texts'
define table tb003t {
  key mandt  : abap.clnt not null;
  key spras  : abap.lang not null;
  key role   : abap.char(6) not null;
  rltitl     : abap.char(40);
}
