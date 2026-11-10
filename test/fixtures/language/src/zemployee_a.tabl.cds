@EndUserText.label : 'Employees'
define table zemployee_a {
  key client  : abap.clnt not null;
  key emp_id  : abap.char(4) not null;
  manager_id  : abap.char(4);
  name        : abap.char(40);
}
