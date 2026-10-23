from setuptools import find_packages, setup

package_name = "dog_vendor_bridge"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
    ],
    install_requires=["setuptools", "pydantic>=2,<3"],
    zip_safe=True,
    maintainer="RailVoice A-3",
    maintainer_email="railvoice-a3@users.noreply.github.com",
    description="Vendor-neutral bridge contract for the robot dog.",
    license="Proprietary",
    python_requires=">=3.10",
)
