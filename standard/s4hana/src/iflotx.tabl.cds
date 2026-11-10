@EndUserText.label : 'Functional location texts'
define table iflotx {
  key mandt : abap.clnt not null;
  key tplnr : abap.char(40) not null;
  key spras : abap.lang not null;
  pltxt     : abap.char(40);
}
