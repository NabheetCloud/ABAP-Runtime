@EndUserText.label : 'Automatic account determination'
define table t030 {
  key mandt : abap.clnt not null;
  key ktopl : abap.char(4) not null;
  key ktosl : abap.char(3) not null;
  key bwmod : abap.char(4) not null;
  key komok : abap.char(4) not null;
  key bklas : abap.char(4) not null;
  konts     : abap.char(20);
  konth     : abap.char(20);
}
