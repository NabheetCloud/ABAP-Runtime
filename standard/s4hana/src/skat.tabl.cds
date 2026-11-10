@EndUserText.label : 'G/L account texts'
define table skat {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key ktopl : abap.char(4) not null;
  key saknr : abap.char(10) not null;
  txt20     : abap.char(20);
  txt50     : abap.char(50);
}
