@EndUserText.label : 'Condition types (pricing)'
define table t685a {
  key mandt : abap.clnt not null;
  key kappl : abap.char(2) not null;
  key kschl : abap.char(4) not null;
  kvewe     : abap.char(1);
  krech     : abap.char(1);
  koaid     : abap.char(1);
  kznep     : abap.char(1);
}
