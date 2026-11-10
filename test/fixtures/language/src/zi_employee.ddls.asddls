@EndUserText.label: 'Employee'
@OData.hierarchy.recursiveHierarchy: [{ entity.name: 'ZI_EmployeeHier' }]
@UI.headerInfo: { typeName: 'Employee', typeNamePlural: 'Employees', title: { value: 'Name' } }
define view entity ZI_Employee as select from zemployee_a
  association [0..1] to ZI_Employee as _Manager on $projection.ManagerId = _Manager.EmpId
{
  key emp_id     as EmpId,
      manager_id as ManagerId,
      @UI.lineItem: [{ position: 10 }]
      name       as Name,
      _Manager
}
