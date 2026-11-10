@EndUserText.label : 'Distribution channel texts'
define table tvtwt {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key vtweg : abap.char(2) not null;
  vtext     : abap.char(20);
}
