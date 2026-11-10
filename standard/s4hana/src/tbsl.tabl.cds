@EndUserText.label : 'Posting keys'
define table tbsl {
  key mandt : abap.clnt not null;
  key bschl : abap.char(2) not null;
  shkzg     : abap.char(1);
  koart     : abap.char(1);
  ltext     : abap.char(40);
}
